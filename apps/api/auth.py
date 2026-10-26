"""Минимальная аутентификация: пользователи + подписанная cookie-сессия.

Пароли хранятся как scrypt-хеш (stdlib). Сессия — HMAC-подписанный токен в
HttpOnly cookie, без отдельной таблицы сессий. Для продакшена задайте
APP_SECRET и включите COOKIE_SECURE=1.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

from fastapi import Request, Response

from .storage import get_user

COOKIE = "furniture_session"
TTL = 60 * 60 * 24 * 30  # 30 дней
SECRET = os.getenv("APP_SECRET", "dev-furniture-secret-change-me")
SECURE = os.getenv("COOKIE_SECURE", "").lower() in ("1", "true", "yes")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32,
    )
    return f"scrypt${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        kind, salt_b64, digest_b64 = encoded.split("$", 2)
        if kind != "scrypt":
            return False
        salt = _unb64(salt_b64)
        expected = _unb64(digest_b64)
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32,
        )
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def make_token(user_id: str) -> str:
    payload = _b64(json.dumps(
        {"uid": user_id, "exp": int(time.time()) + TTL},
        separators=(",", ":"),
    ).encode("utf-8"))
    sig = _b64(hmac.new(
        SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256,
    ).digest())
    return f"{payload}.{sig}"


def read_token(token: str | None) -> str | None:
    if not token:
        return None
    try:
        payload, sig = token.split(".", 1)
        expected = _b64(hmac.new(
            SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256,
        ).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(_unb64(payload))
        if int(data.get("exp", 0)) < int(time.time()):
            return None
        return str(data.get("uid") or "") or None
    except Exception:
        return None


def set_session(response: Response, user_id: str) -> None:
    response.set_cookie(
        COOKIE,
        make_token(user_id),
        max_age=TTL,
        httponly=True,
        samesite="lax",
        secure=SECURE,
        path="/",
    )


def clear_session(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


def current_user(request: Request) -> dict[str, Any] | None:
    uid = read_token(request.cookies.get(COOKIE))
    if not uid:
        return None
    return get_user(uid)


def public_user(user: dict[str, Any] | None) -> dict[str, Any] | None:
    if not user:
        return None
    return {
        "id": user.get("id"),
        "name": user.get("name") or "Пользователь",
        "email": user.get("email"),
        "role": user.get("role") or "user",
        "demo": (user.get("role") or "user") == "guest",
    }
