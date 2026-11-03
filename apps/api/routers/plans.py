"""Импорт планов: PDF, изображения, DXF, SVG.

Файл не сохраняется навсегда: разбираем в памяти и возвращаем превью,
текст, вектор и (если настроена vision-модель) распознанный план комнаты.
"""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from .. import common, plans
from .projects import project_for

router = APIRouter()


@router.post("/api/projects/{pid}/plan")
async def import_plan(
    pid: str, request: Request,
    file: UploadFile = File(...),
    page: int = Form(1),
):
    project_for(request, pid)
    common.heavy_limit(request, "plan", common.PLAN_PER_MIN)
    data = await file.read()
    try:
        return plans.analyze_plan(data, file.filename or "plan", page)
    except plans.PlanError as exc:
        raise HTTPException(415, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"не удалось разобрать план: {exc}") from exc
