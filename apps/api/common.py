"""Общие зависимости API: пути, лимиты, доступ к проектам, профиль цеха."""
from __future__ import annotations

import os
import sys
import time as _time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
PROJECTS = ROOT / "projects"
SHOP = ROOT / "specs" / "shop-default.yaml"
MATERIALS = ROOT / "specs" / "materials.yaml"

if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from furniture_core import load_config  # noqa: E402
from furniture_core.pricing import load_options as load_pricing_options  # noqa: E402

from .auth import current_user  # noqa: E402
from .storage import project_owner  # noqa: E402

SCHEMA = "furniture/project@0"

# Простой in-memory rate limit для публичных/auth-эндпоинтов.
_RATE: dict[str, deque[float]] = defaultdict(deque)


def rate_limit(request: Request, key: str, limit: int, window: int = 60) -> None:
    now = _time.time()
    # Ключи живут вечно (гости приходят и уходят) — изредка подчищаем.
    if len(_RATE) > 4096:
        for stale in [k for k, q in _RATE.items()
                      if not q or q[-1] < now - window]:
            _RATE.pop(stale, None)
    q = _RATE[key]
    while q and q[0] < now - window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(
            429, "слишком много запросов, попробуйте позже",
            headers={"Retry-After": str(window)},
        )
    q.append(now)


# Тяжёлые эндпоинты считаются на пользователя (анонимно — на IP).
# Значения — запросов в минуту; env нужен для тестов/стенда и читается
# при вызове, поэтому тесты могут временно менять порог.
SOLVE_PER_MIN = int(os.getenv("RATE_SOLVE_PER_MIN", "240"))
BATCH_PER_MIN = int(os.getenv("RATE_BATCH_PER_MIN", "120"))
VALIDATE_PER_MIN = int(os.getenv("RATE_VALIDATE_PER_MIN", "240"))
LAYOUT_PER_MIN = int(os.getenv("RATE_LAYOUT_PER_MIN", "300"))
NORMALIZE_PER_MIN = int(os.getenv("RATE_NORMALIZE_PER_MIN", "60"))
SAVE_PER_MIN = int(os.getenv("RATE_SAVE_PER_MIN", "180"))
AI_PER_MIN = int(os.getenv("RATE_AI_PER_MIN", "30"))


def heavy_limit(request: Request, bucket: str, limit: int) -> None:
    user = current_user(request)
    who = (user or {}).get("id") or (
        request.client.host if request.client else "?")
    rate_limit(request, f"{bucket}:{who}", limit)


def new_id(prefix: str) -> str:
    import random
    import time
    return f"{prefix}{int(time.time() * 1000):x}{random.randint(0, 999)}"




def cfg_for_shop(shop_id: str | None):
    """Профиль цеха: файл specs/<id>.yaml или запись из shops.yaml.

    Старые проекты хранят shop-default (файл конфигурации), новые — id цеха
    из specs/shops.yaml. Для нового id берём лист/пропил из shops.yaml,
    остальное — базовый профиль.
    """
    if shop_id:
        path = ROOT / "specs" / f"{shop_id}.yaml"
        if path.exists():
            return load_config(path), path
    cfg = load_config(SHOP)
    if shop_id:
        for row in load_pricing_options().get("shops", []):
            if row.get("id") != shop_id:
                continue
            sheet = row.get("sheet") or {}
            cfg.sheet_w = float(sheet.get("w", cfg.sheet_w))
            cfg.sheet_h = float(sheet.get("h", cfg.sheet_h))
            cfg.trim = float(sheet.get("trim", cfg.trim))
            cfg.kerf = float(sheet.get("kerf", cfg.kerf))
            break
    return cfg, SHOP




def user_or_401(request: Request) -> dict[str, Any]:
    user = current_user(request)
    if not user:
        raise HTTPException(401, "нужно войти в аккаунт")
    return user


def check_project_access(pid: str, user: dict[str, Any]) -> None:
    owner = project_owner(pid)
    if owner is not None and owner != user.get("id"):
        raise HTTPException(403, "проект принадлежит другому пользователю")


def project_for(request: Request, pid: str) -> dict[str, Any]:
    user = user_or_401(request)
    check_project_access(pid, user)
    return user



def version_id() -> str:
    import random
    import time
    return f"v{int(time.time() * 1000):x}{random.randint(0, 999):03x}"
