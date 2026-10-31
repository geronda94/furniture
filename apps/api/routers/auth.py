"""Auth: регистрация, вход, демо-гость, выход."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request, Response

from ..auth import (
    clear_session,
    current_user,
    hash_password,
    public_user,
    set_session,
    verify_password,
)
from ..common import PROJECTS, new_id, rate_limit
from ..models import AuthIn
from ..storage import (
    create_guest,
    create_user,
    find_user_by_email,
    get_project as repo_get,
    prune_guests,
    put_project as repo_put,
)

router = APIRouter()

@router.post("/api/auth/register")
def register(body: AuthIn, response: Response):
    email = body.email.strip().lower()
    if "@" not in email or len(email) < 5:
        raise HTTPException(422, "укажите корректный e-mail")
    if len(body.password) < 8:
        raise HTTPException(422, "пароль должен быть не короче 8 символов")
    if find_user_by_email(email):
        raise HTTPException(409, "пользователь с таким e-mail уже есть")
    user = create_user(email, body.name.strip() or email.split("@")[0],
                       hash_password(body.password))
    set_session(response, user["id"])
    return {"user": public_user(user)}


@router.post("/api/auth/login")
def login(body: AuthIn, request: Request, response: Response):
    rate_limit(request, f"login:{request.client.host if request.client else '?'}", 30)
    user = find_user_by_email(body.email)
    if not user or not verify_password(body.password, user.get("password_hash")):
        raise HTTPException(401, "неверный e-mail или пароль")
    set_session(response, user["id"])
    return {"user": public_user(user)}


@router.post("/api/auth/demo")
def demo_login(request: Request, response: Response):
    """Гостевая сессия с личной копией демо-кухни.

    Гость может свободно двигать мебель и смотреть присадку, но его правки
    не попадают в публичный демо-проект.
    """
    rate_limit(request, f"demo:{request.client.host if request.client else '?'}", 10)
    try:
        prune_guests(7)
    except Exception:
        pass
    seed = repo_get("demo-apartment")
    if seed is None:
        for name in ("demo-apartment", "demo"):
            demo_file = PROJECTS / name / "project.json"
            if demo_file.exists():
                try:
                    seed = json.loads(demo_file.read_text(encoding="utf-8"))
                    break
                except Exception:
                    seed = None
    if seed is None:
        seed = repo_get("demo")
    if seed is None:
        raise HTTPException(503, "демо-проект не найден")
    user = create_guest()
    pid = new_id("demo-")
    doc = json.loads(json.dumps(seed))
    doc["name"] = "Демо — квартира"
    doc.pop("_owner", None)
    repo_put(pid, doc, owner=user["id"])
    set_session(response, user["id"])
    return {"user": public_user(user), "project_id": pid}


@router.post("/api/auth/logout")
def logout(response: Response):
    clear_session(response)
    return {"ok": True}


@router.get("/api/auth/me")
def me(request: Request):
    return {"user": public_user(current_user(request))}


