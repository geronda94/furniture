"""Высокоуровневый solve: изделие -> деталировка + сцена (локальные координаты)."""
from __future__ import annotations

from dataclasses import replace
from collections import Counter

from .config import Config
from .cutting import pack, validate
from .hardware import (
    edge_type_for, find_fastener, find_gas_strut, find_handle, find_hinge,
    Handle, find_runner, find_shelf_support, load_edge_types, load_fasteners,
    load_gas_struts, load_handles, load_hinges, load_legs, load_runners,
    load_shelf_supports,
)
from .pricing import load_options, load_pricing
from .kitchen import Section, gen_kitchen, scene3d
from .assembly import build_operations, summarize, validate_operations
from .parts import apply_edge_policy

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


def solve(product: dict, cfg: Config | None = None, *, market: str | None = None,
          shop: str | None = None, supplier: str | None = None) -> dict:
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
    style = str(params.get("facadeStyle") or "handle")
    if style == "push":
        handle = Handle(id="no-handle", name="Без ручки (push-to-open)",
                        mount="profile", centers=-1)
    elif style == "profile":
        handle = find_handle(handles, "profile-04")
    else:
        handle = find_handle(handles, params.get("handle") or "bar-128")
    fastener_list = load_fasteners()
    fastener = find_fastener(fastener_list, params.get("fastener"))
    shelf_support = find_shelf_support(
        load_shelf_supports(), params.get("shelfSupport"))
    gas_strut = find_gas_strut(load_gas_struts(), params.get("gasStrut"))
    legs_all = load_legs()
    leg_mount = next((l for l in legs_all
                      if l.id == (params.get("legMount") or "leg-plate-60")),
                     legs_all[0] if legs_all else None)
    edge_types = load_edge_types()

    sections = _sections(product, cfg)
    if not sections:
        raise ValueError("нет секций: product.sections пуст")

    facade_material = ("МДФ" if params.get("facadeMaterial") == "mdf"
                       else "ЛДСП")
    parts, total_w, holes = gen_kitchen(
        sections, cfg, runner=runner, hinge=hinge,
        facade_material=facade_material,
    )
    parts = apply_edge_policy(parts, params.get("edges"), edge_types)
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
        fastener=fastener, fasteners=fastener_list,
        shelf_support=shelf_support,
        gas_strut=gas_strut, leg_mount=leg_mount,
        edge_types=edge_types, params=params,
    )
    hardware_plan = summarize(
        operations, runner, handle, hinge, fastener=fastener,
        shelf_support=shelf_support, gas_strut=gas_strut,
        edge_types=edge_types,
    )
    warns += validate_operations(operations, objects, hinge=hinge,
                                 handle=handle)
    side_ru = {"left": "лев", "right": "прав", "top": "верх",
               "bottom": "низ"}

    def edge_sides(part) -> dict:
        rows: dict = {}
        for side, thickness in part.edges.items():
            if not thickness:
                continue
            et = next((t for t in edge_types
                       if t.id == part.edge_kind.get(side)), None)
            if et is None:
                et = edge_type_for(edge_types, float(thickness))
            length = part.w if side in ("top", "bottom") else part.h
            rows[side] = {
                "thickness": round(float(thickness), 2),
                "type": et.id,
                "label": et.name,
                "color": et.color,
                "price_key": et.price_key,
                "front": side == part.front_key,
                "side_label": side_ru.get(side, side),
                "length_m": round(length * part.qty / 1000, 3),
            }
        return rows

    edge_plan = [{
        "part": p.name,
        "qty": p.qty,
        "material": p.material,
        "w": p.w,
        "h": p.h,
        "front": p.front_key,
        "summary": p.edge_summary(),
        "sides": edge_sides(p),
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
        "edges": edge_sides(p),
        "grain": p.grain,
        "front": p.front_key,
    } for p in parts]

    edge_mm: dict[float, float] = {}
    edge_by_type: dict[str, float] = {}
    for plan in edge_plan:
        for side, row in plan["sides"].items():
            thick = float(row["thickness"])
            length = (plan["w"] if side in ("top", "bottom")
                      else plan["h"]) * int(plan["qty"])
            edge_mm[thick] = edge_mm.get(thick, 0) + length
            label = str(row["label"])
            edge_by_type[label] = edge_by_type.get(label, 0) + length
    edges_m = {str(k): round(v / 1000, 2) for k, v in sorted(edge_mm.items())}
    edges_by_type = {k: round(v / 1000, 2)
                     for k, v in sorted(edge_by_type.items())}

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
            d["front"] = {"w": b["sx"], "h": b["sz"], "t": b["sy"],
                          "z": b["z"]}
    floor_z = cfg.plinth_h if cfg.mount != "wall" else 0.0
    top_z = floor_z + cfg.corpus_h
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
            # положение относительно низа модуля / фасада (для сборщика)
            "box_bottom_from_floor": round(box.get("z0", 0) - floor_z, 1),
            "box_top_from_floor": round(box.get("z1", 0) - floor_z, 1),
            "runner_center_from_floor": round(
                (box.get("z0", 0) + box.get("z1", 0)) / 2 - floor_z, 1),
            "front_bottom_from_floor": round(
                float(front.get("z", floor_z)) - floor_z, 1),
            "front_top_from_ceiling": round(
                top_z - float(front.get("z", floor_z))
                - float(front.get("h", 0)), 1),
        })

    shelves_pos = [{
        "section": b.get("sec", 0),
        "z_from_floor": round(b["z"] - floor_z, 1),
        "t": round(b["sz"], 1),
        "w": round(b["sx"], 1),
        "d": round(b["sy"], 1),
        "to_shelf_above": None,
        "from_shelf_below": None,
    } for b in objects if b.get("name") == "Полка"]
    by_sec: dict[int, list[dict]] = {}
    for row in shelves_pos:
        by_sec.setdefault(int(row["section"]), []).append(row)
    for rows in by_sec.values():
        rows.sort(key=lambda r: r["z_from_floor"])
        for i, row in enumerate(rows):
            if i:
                row["from_shelf_below"] = round(
                    row["z_from_floor"] - rows[i - 1]["z_from_floor"]
                    - rows[i - 1]["t"], 1)
            if i + 1 < len(rows):
                row["to_shelf_above"] = round(
                    rows[i + 1]["z_from_floor"] - row["z_from_floor"]
                    - row["t"], 1)

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
    if hardware_plan.get("fasteners"):
        models = sorted({str(j.get("fastener")) for j in
                         (hardware_plan.get("joints") or [])
                         if j.get("fastener")})
        assembly.append(
            f"Соединить корпус: {', '.join(models) or hardware_plan['fastener_model']} — "
            f"{hardware_plan['fasteners']} шт (карта присадки)")
    if any(p.name == "Перегородка" for p in parts):
        assembly.append("Поставить перегородки по схеме")
    if cfg.back != "none":
        assembly.append(
            f"Установить заднюю стенку ({back_material_name(cfg)}): "
            f"скобы/саморезы по периметру")
    if any(p.name == "Полка" for p in parts):
        assembly.append(
            f"Установить полкодержатели ({hardware_plan.get('shelf_support_model')}) "
            f"и полки")
    if hardware_plan.get("hinges"):
        assembly.append(
            f"Навесить двери: {hardware_plan['hinge_model']}, "
            f"{hardware_plan['hinges']} шт петель; отрегулировать")
    if drawers:
        assembly.append(
            f"Установить направляющие {hardware_plan.get('runner_model')} "
            f"и вставить ящики ({len(drawers)} шт)")
        assembly.append("Прикрутить фасады ящиков к передним стенкам коробов")
    if hardware_plan.get("gas_struts"):
        assembly.append(
            f"Установить газовые патроны {hardware_plan.get('gas_strut_model')} "
            f"по шаблону производителя")
    if hardware_plan.get("handles"):
        assembly.append(
            f"Прикрутить ручки: {hardware_plan['handle_model']} — "
            f"{hardware_plan['handles']} шт")
    if hardware_plan.get("leg_holes"):
        assembly.append(
            f"Просверлить дно под опоры: {leg_mount.name if leg_mount else ''} — "
            f"{hardware_plan['leg_holes']} отв. (карта присадки)")
    if cfg.mount != "wall" and cfg.plinth_h > 0:
        assembly.append("Поставить ножки и цоколь")
    if cfg.mount != "wall" and cfg.worktop_t > 0:
        assembly.append("Уложить столешницу и закрепить изнутри саморезами/уголками")
    if params.get("cutouts"):
        assembly.append("Выполнить вырезы в столешнице по присадке")

    # ---- смета ----
    pr = load_pricing(market=market, shop=shop, supplier=supplier)
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
    edge_by_key: dict[str, dict] = {}
    for plan in edge_plan:
        for row in plan["sides"].values():
            key = str(row.get("price_key") or row.get("type"))
            item = edge_by_key.setdefault(key, {
                "label": str(row.get("label")), "m": 0.0,
                "thickness": float(row.get("thickness") or 0),
            })
            item["m"] += float(row.get("length_m") or 0)
    for key, item in edge_by_key.items():
        meters = round(item["m"], 3)
        price = pr.edge_price(key, item["thickness"])
        if not meters:
            continue
        cost_lines.append({
            "key": "edge", "label": f"Кромка: {item['label']}",
            "qty": meters, "unit": "м",
            "unit_price": round(price, 2), "total": round(price * meters, 2),
        })
    if hardware_plan.get("hinges"):
        n = int(hardware_plan["hinges"])
        cost_lines.append({
            "key": "hinges", "label": f"Петли: {hinge.name}",
            "qty": n, "unit": "шт",
            "unit_price": round(pr.hinge, 2),
            "total": round(pr.hinge * n, 2),
        })
    if drawers:
        cost_lines.append({
            "key": "runners", "label": f"Направляющие: {runner.name}",
            "qty": len(drawers), "unit": "компл",
            "unit_price": round(pr.runner_pair, 2),
            "total": round(pr.runner_pair * len(drawers), 2),
        })
    legs = sum(1 for o in objects if o["name"] == "Ножка")
    if legs:
        cost_lines.append({
            "key": "legs", "label": "Опоры",
            "qty": legs, "unit": "шт",
            "unit_price": round(pr.leg, 2), "total": round(pr.leg * legs, 2),
        })
    fronts = sum(1 for o in objects if o["kind"] in ("door", "drawerfront"))
    handle_units = int(hardware_plan.get("handles") or 0)
    if handle.mount == "profile":
        handle_units = 0          # профиль считается метражом, не штуками
    if handle_units:
        price = pr.handle_price(handle.id, handle.price)
        cost_lines.append({
            "key": "handles", "label": f"Ручки: {handle.name}",
            "qty": handle_units, "unit": "шт",
            "unit_price": round(price, 2),
            "total": round(price * handle_units, 2),
        })
    # крепёж — по фактическим операциям присадки и типам соединений
    fw_count: dict[str, dict] = {}
    for o in operations:
        if o.get("kind") != "fastener_face":
            continue
        hid = str(o.get("hardware_id") or "")
        row = fw_count.setdefault(hid, {
            "label": str(o.get("hardware") or hid), "qty": 0,
        })
        row["qty"] += int(o.get("qty", 1))
    for hid, row in fw_count.items():
        price = pr.fastener_price(hid)
        if not price:
            continue
        cost_lines.append({
            "key": f"hw-{hid}", "label": row["label"],
            "qty": row["qty"], "unit": "шт",
            "unit_price": round(price, 2),
            "total": round(price * row["qty"], 2),
        })
    screw_qty = int(hardware_plan.get("screws") or 0)
    if screw_qty and pr.fastener_price("screw"):
        price = pr.fastener_price("screw")
        cost_lines.append({
            "key": "hw-screw", "label": "Саморезы 4×30",
            "qty": screw_qty, "unit": "шт",
            "unit_price": round(price, 2),
            "total": round(price * screw_qty, 2),
        })
    for hw_id, label, key, qty in (
        (shelf_support.id, shelf_support.name, shelf_support.price_key,
         int(hardware_plan.get("shelf_pins") or 0)),
        (gas_strut.id if gas_strut else "", gas_strut.name if gas_strut else "",
         "gas_strut", int(hardware_plan.get("gas_struts") or 0)),
    ):
        if not qty:
            continue
        price = pr.gas_strut if key == "gas_strut" else pr.fastener_price(key)
        if not price:
            continue
        cost_lines.append({
            "key": f"hw-{hw_id}", "label": label,
            "qty": qty, "unit": "шт",
            "unit_price": round(price, 2),
            "total": round(price * qty, 2),
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
    taxable = round(subtotal + markup, 2)
    vat = round(taxable * pr.vat_percent / 100, 2)
    cost = {
        "currency": pr.currency,
        "locale": pr.locale,
        "symbol": pr.symbol,
        "market": pr.market,
        "market_name": pr.market_name,
        "shop": pr.shop,
        "shop_name": pr.shop_name,
        "supplier": pr.supplier,
        "supplier_name": pr.supplier_name,
        "vat_percent": pr.vat_percent,
        "source": pr.source,
        "updated": pr.updated,
        "draft": pr.draft,
        "lines": cost_lines,
        "subtotal": subtotal,
        "markup_percent": pr.markup_percent,
        "markup": markup,
        "partner_percent": pr.partner_percent,
        "partner": partner,
        "total": taxable,
        "vat": vat,
        "total_with_vat": round(taxable + vat, 2),
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
                     "fastener": fastener.as_dict(),
                     "shelf_support": shelf_support.as_dict(),
                     "gas_strut": gas_strut.as_dict() if gas_strut else None,
                     "leg_mount": leg_mount.as_dict() if leg_mount else None,
                     "hinges_all": [h.as_dict() for h in load_hinges()],
                     "runners_all": [
            {"id": r.id, "name": r.name, "brand": r.brand,
             "side_gap": r.side_gap, "lengths": r.lengths,
             "template": r.template}
            for r in runners
        ],
                     "fasteners_all": [f.as_dict()
                                       for f in load_fasteners()],
                     "shelf_supports_all": [s.as_dict()
                                            for s in load_shelf_supports()],
                     "gas_struts_all": [g.as_dict()
                                        for g in load_gas_struts()],
                     "legs_all": [l.as_dict() for l in legs_all],
                     "edge_types_all": [e.as_dict()
                                        for e in edge_types]},
        "drawers": drawers,
        "shelves": shelves_pos,
        "cutouts": cutouts,
        "assembly": assembly,
        "edges_m": edges_m,
        "edges_by_type": edges_by_type,
        "pricing": pr.as_dict(),
        "sheet": {"w": cfg.sheet_w, "h": cfg.sheet_h,
                  "trim": cfg.trim, "kerf": cfg.kerf},
        "dims": dims,
        "cost": cost,
    }
