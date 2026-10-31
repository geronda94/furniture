"""Расчёт: solve, batch, validate."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from .. import common
from ..models import BatchSolveIn, SolveIn
from furniture_core import solve

router = APIRouter()

@router.post("/api/solve")
def solve_endpoint(body: SolveIn, request: Request):
    """Посчитать изделие. Возвращает локальную сцену, BOM и валидацию."""
    common.heavy_limit(request, "solve", common.SOLVE_PER_MIN)
    cfg, _ = common.cfg_for_shop(body.shop)
    try:
        return solve(body.product, cfg, market=body.market,
                     shop=body.shop, supplier=body.supplier)
    except Exception as exc:  # движок должен отвечать понятной ошибкой
        raise HTTPException(422, str(exc)) from exc


@router.post("/api/solve/batch")
def solve_batch(body: BatchSolveIn, request: Request):
    """Посчитать несколько модулей одним запросом (ленивая загрузка комнаты).

    Ошибка одного модуля не ломает остальные: в ответе есть ``error``.
    """
    common.heavy_limit(request, "batch", common.BATCH_PER_MIN)
    cfg, _ = common.cfg_for_shop(body.shop)
    out: list[dict[str, Any]] = []
    for idx, product in enumerate(body.products[:80]):
        item: dict[str, Any] = {"index": idx,
                                "id": (product or {}).get("id")}
        try:
            item["result"] = solve(product, cfg, market=body.market,
                                   shop=body.shop, supplier=body.supplier)
        except Exception as exc:
            item["error"] = str(exc)
        out.append(item)
    return {"results": out}


@router.post("/api/validate")
def validate_endpoint(body: SolveIn, request: Request):
    """Только проверка: ошибки, предупреждения, габариты, состав."""
    common.heavy_limit(request, "validate", common.VALIDATE_PER_MIN)
    cfg, _ = common.cfg_for_shop(body.shop)
    try:
        res = solve(body.product, cfg, market=body.market,
                    shop=body.shop, supplier=body.supplier)
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "ok": not res["validation"]["errors"],
        "validation": res["validation"],
        "dims": res["dims"],
        "totals": res["totals"],
        "bom": res["bom"],
    }


