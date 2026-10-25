"""Высокоуровневый solve: изделие -> деталировка + сцена (локальные координаты)."""
from __future__ import annotations

from dataclasses import replace
from collections import Counter

from .config import Config
from .cutting import pack, validate
from .hardware import (
    find_handle, find_hinge, find_runner, load_handles, load_hinges,
    load_runners,
)
from .pricing import load_pricing
from .kitchen import Section, gen_kitchen, scene3d
from .assembly import build_operations, summarize

SCHEMA = "furniture/product@0"

# kind объекта -> роль материала (для веба и 2.5D)
ROLE = {
    "corpus": "corpus",
    "door": "facade",
    "drawerfront": "facade",
    "drawerbox": "drawer",
    "worktop": "worktop",
    "plinth": "plinth",
    "back": "back",
    "leg": "leg",
}

DEFAULT_MATERIALS = {
    "corpus": {"name": "ЛДСП Дуб натуральный", "color": "#d9c3a3",
               "accent": "#b7956c", "pattern": "wood"},
    "facade": {"name": "ЛДСП Графит", "color": "#3b434b",
               "accent": "#2b3238", "pattern": "solid"},
    "worktop": {"name": "Столешница графит", "color": "#24282c",
                "accent": "#181b1e", "pattern": "stone"},
    "plinth": {"name": "Цоколь антрацит", "color": "#171a1d",
               "accent": "#0e1012", "pattern": "solid"},
    "back": {"name": "ДВП светлая", "color": "#efede7",
             "accent": "#ddd9d0", "pattern": "solid"},
    "cardboard": {"name": "Картон 3 мм", "color": "#c8b48d",
                  "accent": "#a8946c", "pattern": "solid"},
    "drawer": {"name": "Ящик металл", "color": "#9aa0a6",
               "accent": "#7c8288", "pattern": "metal"},
    "leg": {"name": "Ножка", "color": "#1b1c1e",
            "accent": "#101112", "pattern": "solid"},
}


def _fronts(raw) -> list[dict] | None:
    if not isinstance(raw, list):
        return None
    out = []
    for b in raw:
        if not isinstance(b, dict):
            continue
        kind = str(b.get("type") or b.get("kind") or "doors")
        if kind not in ("doors", "drawers", "door", "drawer"):
            continue
        out.append({
            "type": "drawers" if kind.startswith("drawer") else "doors",
            "count": max(1, int(b.get("count", 1))),
            "height": float(b.get("height") or 0),
        })
    return out or None


def back_material_name(cfg: Config) -> str:
    return {"same": "ЛДСП", "cardboard": "картон",
            "dvp": "ДВП"}.get(cfg.back, cfg.back)


def _section_from_params(p: dict) -> Section:
    heights = p.get("drawerHeights") or p.get("drawer_heights") or None
    if heights:
        heights = [float(x) for x in heights if float(x) > 0]
    return Section(
        width=float(p.get("W", 600)),
        doors=int(p.get("doors", 0)),
        drawers=int(p.get("drawers", 0)),
        name=str(p.get("name", "Модуль")),
        shelves=int(p.get("shelves", 2)),
        drawer_heights=heights,
        fronts=_fronts(p.get("fronts") or p.get("frontLayout")),
        dividers=int(p.get("dividers", 0) or 0),
    )


def _sections(product: dict, cfg: Config):
    if product.get("product") == "kitchen":
        out = []
        for s in product.get("sections", []):
            out.append(Section(
                float(s.get("W", s.get("width", 600))),
                int(s.get("doors", 0)),
                int(s.get("drawers", 0)),
                str(s.get("name", "")),
                int(s.get("shelves", 2)),
                [float(x) for x in (s.get("drawerHeights") or [])] or None,
                _fronts(s.get("fronts") or s.get("frontLayout")),
                int(s.get("dividers", 0) or 0),
            ))
        return out
    return [_section_from_params(product.get("params", {}))]


def solve(product: dict, cfg: Config | None = None) -> dict:
    """Посчитать изделие. Координаты сцены — локальные (угол корпуса в 0,0,0)."""
    cfg = replace(cfg or Config())
    params = product.get("params", {}) or {}

    for key, attr, cast in (
        ("H", "corpus_h", float),
        ("D", "corpus_d", float),
        ("t", "t", float),
        ("frame", "frame", str),
        ("hardware", "hardware", str),
        ("runners", "runners", str),
        ("back", "back", str),
        ("backT", "back_t", float),
        ("reinforceH", "reinforce_h", float),
        ("mount", "mount", str),
        ("plinthH", "plinth_h", float),
        ("worktopT", "worktop_t", float),
        ("gapSide", "gap_side", float),
        ("gapBetween", "gap_between", float),
        ("gapTop", "gap_top", float),
        ("gapBottom", "gap_bottom", float),
    ):
        if key in params:
            setattr(cfg, attr, cast(params[key]))
    if "roof" in params:
        cfg.include_roof = bool(params["roof"])
    if "includeRoof" in params:
        cfg.include_roof = bool(params["includeRoof"])
    if "reinforce" in params:
        v = params["reinforce"]
        cfg.reinforce = ("on" if v is True else "off" if v is False
                         else str(v))

    runners = load_runners(cfg.hardware_file if hasattr(cfg, "hardware_file")
                           else None)
    runner = find_runner(runners, cfg.runners)
    hinge = find_hinge(load_hinges(), cfg.hardware)
    handles = load_handles()
    handle = find_handle(handles, params.get("handle") or "bar-128")

    sections = _sections(product, cfg)
    if not sections:
        raise ValueError("нет секций: product.sections пуст")

    parts, total_w, holes = gen_kitchen(sections, cfg, runner=runner,
                                        hinge=hinge)
    sheets, usable_w, usable_h = pack(parts, cfg)
    errs, warns = validate(total_w, cfg.corpus_h, cfg.corpus_d, parts, cfg,
                           sheets, usable_w, usable_h)
    if not cfg.include_roof and cfg.reinforce == "off":
        warns.append("Нет крыши и царг — корпус может потерять жёсткость")
    if cfg.back == "cardboard" and cfg.reinforce == "off":
        warns.append("Картон 3 мм без царг — задняя стенка не держит геометрию")
    if (params.get("cutouts") or []) and cfg.worktop_t <= 0:
        warns.append("Вырезы заданы, но столешница отключена (worktopT=0)")
    cutouts = params.get("cutouts") or []
    objects = scene3d(sections, cfg, runner=runner, cutouts=cutouts)
    operations = build_operations(
        objects, cfg, runner=runner, hinge=hinge, handle=handle,
    )
    hardware_plan = summarize(operations, runner, handle, hinge)
    edge_names = {2.0: "ПВХ 2 мм", 0.4: "ПВХ 0.4 мм", 0.0: "без кромки"}
    edge_plan = [{
        "part": p.name,
        "qty": p.qty,
        "material": p.material,
        "w": p.w,
        "h": p.h,
        "front": p.front_key,
        "summary": p.edge_summary(),
        "sides": {
            side: {
                "thickness": thickness,
                "label": edge_names.get(float(thickness),
                                        f"кромка {thickness:g} мм"),
            }
            for side, thickness in p.edges.items() if thickness
        },
    } for p in parts]
    for c in cutouts if isinstance(cutouts, list) else []:
        if not isinstance(c, dict):
            continue
        holes.append({
            "part": "Столешница", "face": "верх",
            "x": round(float(c.get("x", 0)), 1),
            "y": round(float(c.get("y", 0)), 1),
            "w": round(float(c.get("w", 0)), 1),
            "h": round(float(c.get("h", 0)), 1),
            "note": "вырез под технику/мойку",
        })
    for b in objects:
        role = ROLE.get(b["kind"], "corpus")
        if b["kind"] == "back":
            role = ("corpus" if cfg.back == "same"
                    else "cardboard" if cfg.back == "cardboard" else "back")
        b["role"] = role

    bom = [{
        "name": p.name,
        "qty": p.qty,
        "w": p.w,
        "h": p.h,
        "saw_w": p.saw()[0],
        "saw_h": p.saw()[1],
        "material": p.material,
        "edge": p.edge_summary(),
        "grain": p.grain,
        "front": p.front_key,
    } for p in parts]

    edge_mm: dict[float, float] = {}
    for part in parts:
        for side, thick in part.edges.items():
            if not thick:
                continue
            length = part.w if side in ("top", "bottom") else part.h
            edge_mm[thick] = edge_mm.get(thick, 0) + length * part.qty
    edges_m = {str(k): round(v / 1000, 2) for k, v in sorted(edge_mm.items())}

    # КПД раскроя по ЛДСП
    ld = [s for s in sheets if s["material"] == "ЛДСП"]
    usable = (cfg.sheet_w - 2 * cfg.trim) * (cfg.sheet_h - 2 * cfg.trim)
    used = sum(pl["w"] * pl["h"] for s in ld for pl in s["placements"])
    kpd = round(100 * used / (len(ld) * usable)) if ld else 0

    materials = dict(DEFAULT_MATERIALS)
    materials.update(product.get("materials") or {})

    # габариты: наружные и внутренние (для мастеров/сборщиков)
    t = cfg.t
    dims = {
        "outer": {"W": round(total_w, 1), "H": cfg.corpus_h,
                  "D": cfg.corpus_d},
        "inner": {"W": round(total_w - 2 * t, 1),
                  "H": round(cfg.corpus_h - 2 * t, 1),
                  "D": round(cfg.corpus_d, 1)},
        "t": t,
        "t_back": cfg.t_back,
    }

    # ящики: наружные/внутренние размеры короба по выбранной фурнитуре
    drawers = []
    by_id: dict[int, dict] = {}
    for b in objects:
        did = b.get("drawer_id")
        if did is None:
            continue
        d = by_id.setdefault(did, {
            "id": did, "box": None, "front": None, "panel": None,
        })
        if b["kind"] == "drawerbox":
            x0, y0, z0 = b["x"], b["y"], b["z"]
            x1, y1, z1 = x0 + b["sx"], y0 + b["sy"], z0 + b["sz"]
            box = d["box"] or {"x0": x0, "y0": y0, "z0": z0,
                               "x1": x1, "y1": y1, "z1": z1}
            box["x0"] = min(box["x0"], x0)
            box["y0"] = min(box["y0"], y0)
            box["z0"] = min(box["z0"], z0)
            box["x1"] = max(box["x1"], x1)
            box["y1"] = max(box["y1"], y1)
            box["z1"] = max(box["z1"], z1)
            d["box"] = box
            if b.get("name") == "Ящик передняя стенка":
                d["panel"] = {"w": b["sx"], "h": b["sz"], "t": b["sy"]}
        elif b["kind"] == "drawerfront":
            d["front"] = {"w": b["sx"], "h": b["sz"], "t": b["sy"]}
    t = cfg.t
    for d in by_id.values():
        box = d.get("box") or {}
        front = d.get("front") or {}
        panel = d.get("panel") or {}
        box_w = round(box.get("x1", 0) - box.get("x0", 0), 1)
        box_h = round(box.get("z1", 0) - box.get("z0", 0), 1)
        box_len = round(box.get("y1", 0) - box.get("y0", 0), 1)
        drawers.append({
            "id": d["id"],
            "box_w": box_w,
            "box_h": box_h,
            "box_len": box_len,
            "inner_w": round(box_w - 2 * t, 1),
            "inner_h": round(box_h - 2 * t, 1),
            "inner_len": round(box_len - 2 * t, 1),
            "front_w": round(front.get("w", 0), 1),
            "front_h": round(front.get("h", 0), 1),
            "front_t": round(front.get("t", t), 1),
            "panel_w": round(panel.get("w", box_w - 2 * t), 1),
            "panel_h": round(panel.get("h", box_h), 1),
            "panel_t": round(panel.get("t", t), 1),
            "side_gap": round(runner.side_gap, 1),
            "side_extra": round(runner.side_extra, 1),
            "side_h": round(box_h + runner.side_extra, 1),
            "runner_note": runner.note,
        })

    if drawers:
        holes.append({
            "part": "Ящик передняя стенка", "face": "изнутри",
            "dia": 4, "depth": 0,
            "note": "крепление фасада ящика: саморезы 4×30 изнутри короба",
        })
        holes.append({
            "part": "Ящик дно", "face": "снизу",
            "dia": 0, "depth": 0,
            "note": f"направляющие {runner.name}: {runner.note}",
        })

    assembly = ["Проверить деталировку и кромку по карте раскроя"]
    if cfg.back != "none":
        assembly.append(f"Установить заднюю стенку ({back_material_name(cfg)})")
    assembly.append("Присадить боковины System 32 и соединить корпус")
    if any(p.name == "Перегородка" for p in parts):
        assembly.append("Поставить перегородки по схеме")
    if any(p.name == "Полка" for p in parts):
        assembly.append("Установить полкодержатели и полки")
    if params.get("doors") or any(
            b.get("type") == "doors" for b in (params.get("fronts") or [])):
        assembly.append("Навесить двери и отрегулировать петли")
    if params.get("drawers") or any(
            b.get("type") == "drawers" for b in (params.get("fronts") or [])):
        assembly.append("Установить направляющие и вставить ящики")
        assembly.append("Прикрутить фасады ящиков к передним стенкам коробов")
    if cfg.mount != "wall" and cfg.plinth_h > 0:
        assembly.append("Поставить ножки и цоколь")
    if cfg.mount != "wall" and cfg.worktop_t > 0:
        assembly.append("Уложить столешницу")
    if params.get("cutouts"):
        assembly.append("Выполнить вырезы в столешнице по присадке")

    # ---- смета ----
    pr = load_pricing()
    cost_lines: list[dict] = []
    sheet_counts = Counter(str(s["material"]) for s in sheets)
    material_area: dict[str, float] = {}
    for sh in sheets:
        mat = str(sh["material"])
        material_area[mat] = material_area.get(mat, 0.0) + sum(
            float(pl["w"]) * float(pl["h"]) for pl in sh.get("placements", [])
        ) / 1e6
    for mat, n in sheet_counts.items():
        area = material_area.get(mat, 0.0)
        if mat == "Столешница":
            # столешница в деталировке — полоса по толщине; площадь берём из 3D
            area = sum(
                float(o["sx"]) * float(o["sy"])
                for o in objects if o.get("kind") == "worktop"
            ) / 1e6
        unit = pr.materials.get(mat, 0.0)
        qty = round(area * (1 + pr.waste_percent / 100), 2)
        cost_lines.append({
            "key": "material", "label": f"Материал: {mat}",
            "qty": qty, "unit": "м²", "unit_price": round(unit, 2),
            "total": round(unit * qty, 2),
        })
    cutting = pr.cutting_per_sheet * len(sheets)
    if cutting:
        cost_lines.append({
            "key": "cutting", "label": "Раскрой (листы)",
            "qty": len(sheets), "unit": "лист",
            "unit_price": round(pr.cutting_per_sheet, 2),
            "total": round(cutting, 2),
        })
    edge_total = 0.0
    for t, meters in edges_m.items():
        price = pr.edge.get(str(t), 0.0)
        if not price or not meters:
            continue
        edge_total += price * meters
        cost_lines.append({
            "key": "edge", "label": f"Кромка {t} мм",
            "qty": meters, "unit": "м",
            "unit_price": round(price, 2), "total": round(price * meters, 2),
        })
    hinge_total = sum(float(h.get("hinges", 0) or 0) for h in holes)
    if hinge_total:
        cost_lines.append({
            "key": "hinges", "label": "Петли",
            "qty": hinge_total, "unit": "шт",
            "unit_price": pr.hinge, "total": round(pr.hinge * hinge_total, 2),
        })
    if drawers:
        cost_lines.append({
            "key": "runners", "label": "Направляющие ящиков",
            "qty": len(drawers), "unit": "компл",
            "unit_price": pr.runner_pair, "total": round(pr.runner_pair * len(drawers), 2),
        })
    legs = sum(1 for o in objects if o["name"] == "Ножка")
    if legs:
        cost_lines.append({
            "key": "legs", "label": "Опоры",
            "qty": legs, "unit": "шт",
            "unit_price": pr.leg, "total": round(pr.leg * legs, 2),
        })
    fronts = sum(1 for o in objects if o["kind"] in ("door", "drawerfront"))
    if fronts:
        price = handle.price or pr.handle
        cost_lines.append({
            "key": "handles", "label": f"Ручки: {handle.name}",
            "qty": fronts, "unit": "шт",
            "unit_price": round(price, 2),
            "total": round(price * fronts, 2),
        })
    doors_n = sum(1 for o in objects if o["kind"] == "door")
    drawers_n = len(drawers)
    asm = pr.assembly_module + pr.assembly_door * doors_n + pr.assembly_drawer * drawers_n
    cost_lines.append({
        "key": "assembly", "label": "Сборка",
        "qty": 1, "unit": "модуль", "unit_price": round(asm, 2),
        "total": round(asm, 2),
    })
    subtotal = round(sum(x["total"] for x in cost_lines), 2)
    markup = round(subtotal * pr.markup_percent / 100, 2)
    partner = round(subtotal * pr.partner_percent / 100, 2)
    cost = {
        "currency": pr.currency,
        "lines": cost_lines,
        "subtotal": subtotal,
        "markup_percent": pr.markup_percent,
        "markup": markup,
        "partner_percent": pr.partner_percent,
        "partner": partner,
        "total": round(subtotal + markup, 2),
    }

    return {
        "schema": SCHEMA,
        "product": product.get("product", "base-cabinet"),
        "corpus": {
            "W": round(total_w, 1),
            "H": cfg.corpus_h,
            "D": cfg.corpus_d,
        },
        "objects": objects,
        "bom": bom,
        "drilling": holes,
        "operations": operations,
        "hardware_plan": hardware_plan,
        "edge_plan": edge_plan,
        "sheets": [{
            "material": s["material"],
            "count": len(s["placements"]),
            "overflow": s.get("overflow", []),
        } for s in sheets],
        "totals": {
            "positions": len(parts),
            "pieces": sum(p.qty for p in parts),
            "sheets": len(sheets),
            "kpd": kpd,
        },
        "validation": {"errors": errs, "warnings": warns},
        "materials": materials,
        "hardware": {**runner.as_dict(), "hinge": hinge.as_dict(),
                     "handles": [h.as_dict() for h in handles],
                     "handle": handle.as_dict(),
                     "hinges_all": [h.as_dict() for h in load_hinges()],
                     "runners_all": [
            {"id": r.id, "name": r.name, "brand": r.brand,
             "side_gap": r.side_gap, "lengths": r.lengths}
            for r in runners
        ]},
        "drawers": drawers,
        "cutouts": cutouts,
        "assembly": assembly,
        "edges_m": edges_m,
        "sheet": {"w": cfg.sheet_w, "h": cfg.sheet_h,
                  "trim": cfg.trim, "kerf": cfg.kerf},
        "dims": dims,
        "cost": cost,
    }
