"""Выгрузки проекта: SVG раскроя, DXF деталей, XLSX (детали/раскрой/присадка)."""
from __future__ import annotations

import io
import tempfile
from urllib.parse import quote
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from openpyxl import Workbook

from .. import common
from ..common import cfg_for_shop, project_for
from ..branding import load_branding
from ..pdf import build_quote
from ..storage import get_project as repo_get
from furniture_core import solve
from furniture_core.cutting import pack as pack_sheets, svg_cutting
from furniture_core.dxf import parts_dxf
from furniture_core.parts import Part

router = APIRouter()


def _cd(name: str, ext: str) -> str:
    """Content-Disposition с UTF-8 именем (RFC 5987)."""
    return ("attachment; filename=\"export.{ext}\""
            .format(ext=ext) + "; filename*=UTF-8''" + quote(f"{name}.{ext}"))


def _collect(doc: dict[str, Any]):
    cfg, _ = cfg_for_shop(doc.get("shop"))
    globals_ = {k: v for k, v in (doc.get("globals") or {}).items()
                if k != "autoApply"}
    parts: list[Part] = []
    solved: list[tuple[dict, dict]] = []
    errors: list[str] = []
    for inst in doc.get("instances", []):
        product = {**inst, "params": {**globals_,
                                      **(inst.get("params") or {})}}
        try:
            res = solve(product, cfg, market=doc.get("market"),
                        shop=doc.get("shop"), supplier=doc.get("supplier"))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{inst.get('name') or inst.get('id')}: {exc}")
            continue
        solved.append((inst, res))
        for row in res.get("parts", []):
            try:
                parts.append(Part(**row))
            except TypeError:
                continue
    sheets, uw, uh = pack_sheets(parts, cfg) if parts else ([], 0, 0)
    return cfg, parts, sheets, solved, errors


def _doc_or_404(pid: str, request: Request) -> dict:
    project_for(request, pid)
    doc = repo_get(pid)
    if doc is None:
        raise HTTPException(404, "проект не найден")
    return doc


@router.post("/api/projects/{pid}/export/{fmt}")
def export_project(pid: str, fmt: str, request: Request):
    """Выгрузка в SVG/DXF/XLSX. Расчёт общий, раскрой — совместный."""
    doc = _doc_or_404(pid, request)
    common.heavy_limit(request, "layout", common.LAYOUT_PER_MIN)
    cfg, parts, sheets, solved, errors = _collect(doc)
    if not parts:
        raise HTTPException(422, "нечего выгружать: нет деталей")
    name = str(doc.get("name") or "project").replace("/", "-")
    fmt = fmt.lower()
    headers = {"X-Export-Errors": str(len(errors))}

    if fmt == "svg":
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cut.svg"
            svg_cutting(sheets, cfg, path)
            data = path.read_bytes()
        return Response(
            data, media_type="image/svg+xml",
            headers={**headers,
                     "Content-Disposition": _cd(f"{name}-раскрой", "svg")},
        )

    if fmt == "dxf":
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "parts.dxf"
            parts_dxf(parts, path)
            data = path.read_bytes()
        return Response(
            data, media_type="application/dxf",
            headers={**headers,
                     "Content-Disposition": _cd(f"{name}-детали", "dxf")},
        )

    if fmt == "xlsx":
        wb = Workbook()
        ws = wb.active
        ws.title = "Детали"
        ws.append(["Модуль", "Деталь", "Кол-во", "W", "H", "Пильный W",
                   "Пильный H", "Материал", "Кромка", "Волокно"])
        for inst, res in solved:
            for b in res.get("bom", []):
                ws.append([inst.get("name") or inst.get("id"), b.get("name"),
                           b.get("qty"), b.get("w"), b.get("h"),
                           b.get("saw_w"), b.get("saw_h"), b.get("material"),
                           b.get("edge"), b.get("grain")])

        wc = wb.create_sheet("Раскрой")
        wc.append(["Материал", "Лист", "Деталь", "X", "Y", "W", "H", "Поворот"])
        for sheet in sheets:
            for i, pl in enumerate(sheet.get("placements", []), start=1):
                wc.append([sheet.get("material"), i, pl.get("name"),
                           pl.get("x"), pl.get("y"), pl.get("w"),
                           pl.get("h"), "да" if pl.get("rot") else ""])

        wd = wb.create_sheet("Присадка")
        wd.append(["Модуль", "Деталь", "Операция", "Фурнитура", "Пласть",
                   "X", "Y", "Ø", "Глубина", "Кол-во", "Шаблон"])
        for inst, res in solved:
            for o in res.get("operations", []):
                wd.append([inst.get("name") or inst.get("id"), o.get("part"),
                           o.get("kind"), o.get("hardware"), o.get("face"),
                           o.get("x"), o.get("y"), o.get("dia"),
                           o.get("depth"), o.get("qty"),
                           "да" if o.get("requires_pattern") else ""])

        wh = wb.create_sheet("Фурнитура")
        wh.append(["Модуль", "Фурнитура", "Кол-во"])
        for inst, res in solved:
            for o in res.get("operations", []):
                if o.get("hardware"):
                    wh.append([inst.get("name") or inst.get("id"),
                               o.get("hardware"), o.get("qty") or 1])

        we = wb.create_sheet("Смета")
        we.append(["Модуль", "Строка", "Кол-во", "Ед.", "Цена", "Сумма"])
        total = 0.0
        for inst, res in solved:
            cost = res.get("cost") or {}
            for line in cost.get("lines", []):
                we.append([inst.get("name") or inst.get("id"),
                           line.get("label"), line.get("qty"),
                           line.get("unit"), line.get("unit_price"),
                           line.get("total")])
            total += float(cost.get("total_with_vat")
                           or cost.get("subtotal") or 0)
        we.append(["ИТОГО", "", "", "", "", round(total, 2)])

        buf = io.BytesIO()
        wb.save(buf)
        return Response(
            buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument."
                       "spreadsheetml.sheet",
            headers={**headers,
                     "Content-Disposition": _cd(name, "xlsx")},
        )

    raise HTTPException(404, "формат: svg, dxf или xlsx")


@router.post("/api/projects/{pid}/quote.pdf")
def quote_pdf(pid: str, request: Request):
    """PDF коммерческого предложения по проекту (A4, кириллица)."""
    doc = _doc_or_404(pid, request)
    common.heavy_limit(request, "layout", common.LAYOUT_PER_MIN)
    _cfg, _parts, _sheets, solved, _errors = _collect(doc)
    modules: list[dict[str, Any]] = []
    meta: dict[str, Any] = {}
    for inst, res in solved:
        dims = res.get("dims") or {}
        outer = dims.get("outer") or {}
        cost = res.get("cost") or {}
        if not meta and cost:
            meta = {
                "currency": cost.get("currency"),
                "symbol": cost.get("symbol"),
                "market_name": cost.get("market_name"),
                "shop_name": cost.get("shop_name"),
                "supplier_name": cost.get("supplier_name"),
                "draft": cost.get("draft"),
            }
        modules.append({
            "name": inst.get("name") or inst.get("id"),
            "w": outer.get("W", 0), "h": outer.get("H", 0),
            "d": outer.get("D", 0),
            "pieces": (res.get("totals") or {}).get("pieces", 0),
            "sheets": (res.get("totals") or {}).get("sheets", 0),
            "cost": cost.get("total_with_vat") or cost.get("subtotal") or 0,
        })
    if not modules:
        raise HTTPException(422, "нечего выгружать: нет модулей")
    meta["brand"] = load_branding(doc.get("shop"))
    name = str(doc.get("name") or "project")
    try:
        data = build_quote(doc, modules, meta)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return Response(
        data, media_type="application/pdf",
        headers={"Content-Disposition": _cd(f"{name}-КП", "pdf")},
    )
