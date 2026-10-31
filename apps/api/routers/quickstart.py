"""Быстрый старт: комната + сценарий → готовый проект."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import common
from ..common import new_id, user_or_401
from ..quickstart import GLOBALS, generate
from ..storage import put_project as repo_put
from furniture_core.layout import validate_layout
from furniture_core.scene import validate_scene
from furniture_core.standards import validate_standards

router = APIRouter()


class RoomIn(BaseModel):
    w: float = Field(3600, ge=1200, le=12000)
    d: float = Field(2800, ge=1200, le=12000)
    h: float = Field(2700, ge=2000, le=4500)
    wallT: float = Field(100, ge=40, le=300)
    # Г-образная комната: вырез в правом дальнем углу
    shape: str = "rect"
    cutW: float = Field(0, ge=0, le=8000)
    cutD: float = Field(0, ge=0, le=8000)


class OpeningIn(BaseModel):
    kind: str = "window"
    wall: int = 0
    x: float = 0
    w: float = 1200
    z0: float | None = None
    z1: float | None = None


class SocketIn(BaseModel):
    kind: str = "socket"
    wall: int = 0
    x: float = 300
    z: float = 1100


class QuickIn(BaseModel):
    name: str = "Новый проект"
    room: RoomIn = RoomIn()
    kind: str = "kitchen"
    wall: int = 0
    openings: list[OpeningIn] = []
    sockets: list[SocketIn] = []
    height: float = Field(2400, ge=1800, le=2700)


def _issues(doc: dict[str, Any]) -> list[dict[str, Any]]:
    seen: set[tuple] = set()
    out: list[dict[str, Any]] = []
    for issue in (validate_layout(doc) + validate_scene(doc)
                  + validate_standards(doc)):
        key = (issue.get("code"), issue.get("instance"), issue.get("prop"),
               issue.get("message"))
        if key in seen:
            continue
        seen.add(key)
        out.append(issue)
    return out


def _project(body: QuickIn) -> dict[str, Any]:
    w = round(body.room.w)
    d = round(body.room.d)
    cut_w = round(body.room.cutW)
    cut_d = round(body.room.cutD)
    if body.room.shape == "l":
        cut_w = max(600, min(w - 600, cut_w or round(w * 0.35)))
        cut_d = max(600, min(d - 600, cut_d or round(d * 0.35)))
        outline = [[0, 0], [w, 0], [w, d - cut_d],
                   [w - cut_w, d - cut_d], [w - cut_w, d], [0, d]]
    else:
        cut_w = cut_d = 0
        outline = [[0, 0], [w, 0], [w, d], [0, d]]
    doc: dict[str, Any] = {
        "schema": common.SCHEMA,
        "name": body.name.strip() or "Новый проект",
        "shop": "shop-ro-bucuresti",
        "market": "ro",
        "supplier": "generic",
        "room": {
            "w": w, "d": d, "h": round(body.room.h),
            "wallT": round(body.room.wallT),
            "outline": outline,
            "partitions": [],
            "openings": [],
            "wallItems": [],
            "floor": {"enabled": True, "material": "floor", "t": 0},
            "ceiling": {"enabled": False, "material": "ceiling", "t": 0},
        },
        "instances": [],
        "folders": [],
        "globals": dict(GLOBALS),
        "materials": {},
        "materialVars": [],
        "finishes": [],
        "zones": [],
        "props": [],
        "views": [],
        "log": [],
        "wallMode": "cutaway",
        "camera3d": {"alpha": -90, "beta": 20},
    }
    try:
        generate(
            doc, body.kind, body.wall,
            openings=[o.model_dump() for o in body.openings],
            sockets=[s.model_dump() for s in body.sockets],
            height=body.height,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return doc


@router.post("/api/quickstart")
def quickstart(body: QuickIn, request: Request):
    """Создать проект «под ключ»: комната, проёмы, мебель по сценарию."""
    user = user_or_401(request)
    common.heavy_limit(request, "save", common.SAVE_PER_MIN)
    doc = _project(body)
    issues = _issues(doc)
    errors = [i for i in issues if i.get("level") == "error"]
    if errors:
        # Не сохраняем заведомо неверную расстановку: пусть пользователь
        # поменяет стену/проёмы, а не получит «готовый» брак.
        raise HTTPException(422, {
            "message": "быстрый старт не прошёл проверку",
            "errors": len(errors),
            "issues": issues,
        })
    pid = new_id("p")
    try:
        repo_put(pid, doc, owner=user.get("id"))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "id": pid,
        "project": doc,
        "errors": 0,
        "warnings": len(issues),
        "issues": issues,
    }
