"""Модули кухни: секции, двери, ящики и 3D-расстановка (мм)."""
from __future__ import annotations

from dataclasses import dataclass

from .config import Config, HINGE_CUP_DIA, HINGE_CUP_OFFSET
from .hardware import DEFAULT_RUNNER, Hinge, Runner
from .parts import Part, hinge_count, merge_parts, segment

RAIL_GAP = 21.0          # зазор по умолчанию (Blum Tandem)
RAIL_LEN = 500.0
DRAWER_BOX_H = 150.0
EF = 2.0                 # видимая кромка
EI = 0.4                 # внутренняя кромка
MAX_DOOR_W = 600.0       # стандарт: дверь не шире 600
MAX_DRW_W = 900.0        # стандарт: фасад ящика не шире 900


def back_thickness(cfg: Config) -> float:
    if cfg.back == "none":
        return 0.0
    if cfg.back == "same":
        return cfg.t
    return float(cfg.back_t or cfg.t_back)


def back_material(cfg: Config) -> str:
    if cfg.back == "cardboard":
        return "Картон"
    if cfg.back == "same":
        return "ЛДСП"
    return "ДВП"


def lower_rail_height(cfg: Config) -> float:
    """Насколько поднять стойку/полки над нижней царгой."""
    rear = cfg.back in ("none", "cardboard") or cfg.reinforce == "on"
    return cfg.t if rear else 0.0


def reinforce_layout(cfg: Config) -> list[dict]:
    """Царги (укрепляющие плашки 5–7 см) для корпуса без крыши/задника."""
    if cfg.reinforce == "off":
        return []
    top = (not cfg.include_roof) or cfg.reinforce == "on"
    rear = cfg.back in ("none", "cardboard") or cfg.reinforce == "on"
    # царга не должна пересекать крышу/дно: при наличии крыши — под ней
    top_z = cfg.corpus_h - cfg.t - (0 if not cfg.include_roof else cfg.t)
    bottom_z = cfg.t
    out = []
    if top:
        out.append({"name": "Царга верхняя", "y": 0.0, "z": top_z})
        out.append({"name": "Царга верхняя",
                    "y": cfg.corpus_d - cfg.reinforce_h, "z": top_z})
    if rear:
        out.append({"name": "Царга нижняя",
                    "y": cfg.corpus_d - cfg.reinforce_h, "z": bottom_z})
        if not top:
            out.append({"name": "Царга верхняя",
                        "y": cfg.corpus_d - cfg.reinforce_h, "z": top_z})
    return out


@dataclass
class Section:
    width: float
    doors: int = 0
    drawers: int = 0
    name: str = ""
    shelves: int = 2
    """Высоты фасадов ящиков, мм (последний добирает остаток)."""
    drawer_heights: list[float] | None = None
    # произвольная компоновка фасадов сверху вниз:
    # [{"type": "doors"|"drawers", "count": 1, "height": 200}, ...]
    fronts: list[dict] | None = None
    """Явные внутренние перегородки (0 — корпус без стоек)."""
    dividers: int = 0

    def label(self):
        if self.name:
            return self.name
        bits = []
        if self.drawers:
            bits.append(f"{self.drawers} ящ.")
        if self.doors:
            bits.append(f"{self.doors} дв.")
        return " + ".join(bits) or "секция"


def parse_sections(spec, cfg: Config | None = None):
    """'1600:2:1:Тумба,1700:2:0:Мойка,...'  width:doors:drawers:name"""
    out = []
    for tok in spec.split(","):
        tok = tok.strip()
        if not tok:
            continue
        p = tok.split(":")
        w = float(p[0])
        doors = int(p[1]) if len(p) > 1 and p[1] else 0
        drawers = int(p[2]) if len(p) > 2 and p[2] else 0
        name = p[3] if len(p) > 3 else ""
        out.append(Section(w, doors, drawers, name))
    return out


def drawer_box(inner_w, drawer_front_h, cfg, visible=True,
               runner: Runner | None = None):
    """Детали выкатного ящика. Зазор и номинал — из выбранной фурнитуры.

    Короб — полый: 2 боковины, передняя и задняя стенки, дно.
    Передняя стенка короба — это та панель, к которой изнутри саморезами
    крепится фасад; без неё фасад нельзя ставить «в воздух».
    """
    r = runner or DEFAULT_RUNNER
    box_w = inner_w - 2 * r.side_gap
    box_len = r.length_for(cfg.corpus_d)
    box_h = min(r.box_height,
                max(70.0, drawer_front_h - 20 - r.side_extra))
    side_h = box_h + r.side_extra
    # верхний торец борта/стенок ящика виден при открытии → кромка
    ed_top = EI
    t = cfg.t
    inner = max(30.0, box_w - 2 * t)
    depth_inner = max(30.0, box_len - 2 * t)
    return [
        # борта выше переда/зада: к ним крепятся скрытые направляющие снизу
        Part("Ящик боковина", 2, box_len, side_h, "ЛДСП", {"top": ed_top}),
        # передняя стенка короба: к ней крепится фасад
        Part("Ящик передняя стенка", 1, inner, box_h, "ЛДСП",
             {"top": ed_top}),
        # задняя стенка и дно — между боковинами/стенками, без нахлёста
        Part("Ящик задняя стенка", 1, inner, box_h, "ЛДСП",
             {"top": ed_top}),
        Part("Ящик дно", 1, inner, depth_inner, "ЛДСП", {}),
    ]


def _drawer_heights(s, cfg, fh_total):
    """Высоты фасадов ящиков: свои, если заданы, иначе поровну.

    Последний ящик добирает остаток, чтобы набор всегда вписывался в проём.
    """
    nd = _split_count(s.width, max(1, s.drawers), cfg, MAX_DRW_W)
    avail = fh_total - (nd - 1) * cfg.gap_between
    hs = [float(x) for x in (s.drawer_heights or []) if float(x) > 0][:nd]
    if len(hs) == nd:
        last = avail - sum(hs[:-1])
        if last >= 100:
            hs[-1] = last
            return hs
    return [avail / nd] * nd


def _door_count(s) -> int:
    if s.fronts:
        return sum(b["count"] for b in s.fronts if b["type"] == "doors")
    return s.doors


def _drawer_count(s) -> int:
    if s.fronts:
        return sum(b["count"] for b in s.fronts if b["type"] == "drawers")
    return s.drawers


def _custom_blocks(s, cfg, fh_total):
    """Компоновка фасадов сверху вниз: высоты и z0 относительно проёма.

    Блок без height получает остаток; последний автоматически добирает
    погрешность, чтобы набор всегда вписывался в проём.
    """
    raw = [b for b in (s.fronts or []) if isinstance(b, dict)]
    if not raw:
        return []
    gap = cfg.gap_between
    avail = fh_total - gap * (len(raw) - 1)
    fixed = sum(float(b.get("height") or 0) for b in raw)
    autos = sum(1 for b in raw if not float(b.get("height") or 0))
    auto_h = max(0.0, (avail - fixed) / autos) if autos else 0.0
    heights = [float(b.get("height") or 0) or auto_h for b in raw]
    if sum(heights) > avail and sum(heights) > 0:
        k = avail / sum(heights)
        heights = [h * k for h in heights]
    # остаток — в последний блок
    diff = avail - sum(heights)
    if heights:
        heights[-1] += diff
    out = []
    z = fh_total
    for b, h in zip(raw, heights):
        h = max(40.0, h)
        z -= h
        out.append({
            "type": "drawers" if b.get("type") in ("drawers", "drawer")
                    else "doors",
            "count": max(1, int(b.get("count", 1))),
            "h": h,
            "z0": z,
        })
        z -= gap
    return out


def _door_zone(s, cfg, fh_total):
    """Зона дверей в произвольной компоновке: (z0, h) или None."""
    if not s.fronts:
        return None
    blocks = [b for b in _custom_blocks(s, cfg, fh_total)
              if b["type"] == "doors"]
    if not blocks:
        return None
    main = max(blocks, key=lambda b: b["h"])
    return main["z0"], main["h"]


def _drawer_rows(block, cfg):
    """Разбить блок ящиков на ряды: [(z0, h), ...] снизу вверх."""
    n = max(1, int(block["count"]))
    h = (block["h"] - (n - 1) * cfg.gap_between) / n
    return [(block["z0"] + i * (h + cfg.gap_between), h) for i in range(n)]


def _compartments(W, t, part_xs):
    """Отсеки внутри корпуса с учётом стоек: [(x0, x1), ...] (локально)."""
    out = []
    x0 = t
    for px in part_xs:
        out.append((x0, px))
        x0 = px + t
    out.append((x0, W - t))
    return [(a, b) for a, b in out if b - a > 30]


def _divider_positions(W: float, t: float, dividers: int) -> list[float]:
    """Центры явных перегородок. По умолчанию перегородок нет.

    Две двери не означают перегородку: каждая створка вешается на свою
    крайнюю боковину/стойку, а средняя стойка нужна только по конструкции.
    """
    n = max(0, min(4, int(dividers or 0)))
    if not n:
        return []
    inner = W - 2 * t
    return [t + (k + 1) * inner / (n + 1) - t / 2 for k in range(n)]


def _drawer_inner_width(W: float, t: float, dividers: int) -> float:
    """Внутренняя ширина отсека для короба ящика (с учётом перегородок)."""
    n = max(0, min(4, int(dividers or 0)))
    return (W - 2 * t - n * t) / (n + 1)


def _split_count(W, requested, cfg, maxw):
    """Сколько фасадов нужно, чтобы каждый был не шире стандарта."""
    avail = W - 2 * cfg.gap_side
    n = max(1, requested)
    while (avail - (n - 1) * cfg.gap_between) / n > maxw + 1e-6:
        n += 1
    return n


def gen_kitchen(sections, cfg: Config, open_sections=(),
                runner: Runner | None = None, hinge: Hinge | None = None,
                facade_material: str = "ЛДСП"):
    t = cfg.t
    parts = []
    holes = []
    legs_n = 0
    total_w = sum(s.width for s in sections)

    if cfg.mount != "wall":
        if cfg.plinth_h > 0:
            # цоколь: сегментируем по формату листа, передний торец виден
            parts += segment("Цоколь", total_w - 2 * t, cfg.plinth_h, cfg,
                             front_key="bottom", edges={"bottom": EI})
        if cfg.worktop_t > 0:
            # столешница-постформинг: сегментируем; передний торец без кромки
            parts += segment("Столешница", total_w, cfg.worktop_t, cfg,
                             front_key="bottom", edges={},
                             material="Столешница")

    for i, s in enumerate(sections):
        W, H, D = s.width, cfg.corpus_h, cfg.corpus_d
        fh_total = H - cfg.gap_top - cfg.gap_bottom
        is_open = i in open_sections
        n_doors = _door_count(s)
        n_drawers = _drawer_count(s)
        has_facade = (n_doors + n_drawers) > 0 and not is_open

        # --- корпус ---
        overlay = (cfg.frame == "overlay")
        side_h = H - 2 * t if overlay else H
        top_w = W if overlay else W - 2 * t
        # Кромка — по фактической видимости торцов.
        # Вкладной каркас: боковины на всю высоту, крыша/дно между ними —
        # верхний и нижний торцы боковины открыты. Накладной: боковины между
        # крышей и дном — их торцы закрыты, а боковые торцы крыши/дна видны.
        side_edges = {"right": EF}
        if not (overlay and cfg.include_roof):
            side_edges["top"] = EF
        if not overlay:
            side_edges["bottom"] = EF
        if cfg.back == "none":
            side_edges["left"] = EI
        parts.append(Part("Боковина лев.", 1, D, side_h, "ЛДСП",
                          dict(side_edges), front_key="right"))
        parts.append(Part("Боковина прав.", 1, D, side_h, "ЛДСП",
                          dict(side_edges), front_key="right"))
        # Крыша/дно: передний торец виден; при накладном каркасе видны и
        # боковые торцы, при отсутствии задника — задний.
        cr_ed = {"bottom": EF}
        if overlay:
            cr_ed["left"] = EF
            cr_ed["right"] = EF
        if cfg.back == "none":
            cr_ed["top"] = EI
        if cfg.include_roof:
            parts.append(Part("Крыша", 1, top_w, D, "ЛДСП", dict(cr_ed),
                              front_key="bottom"))
        parts.append(Part("Дно", 1, top_w, D, "ЛДСП", dict(cr_ed),
                          front_key="bottom"))
        if cfg.back != "none":
            parts.append(Part("Задняя стенка", 1, W, H,
                              back_material(cfg), {}))
        # царги: без крыши / при тонком или отсутствующем заднике
        rails = reinforce_layout(cfg)
        if rails:
            by_name: dict[str, int] = {}
            for r in rails:
                by_name[r["name"]] = by_name.get(r["name"], 0) + 1
            rail_edges = {"bottom": EF}
            if cfg.back == "none":
                rail_edges["top"] = EI
            for name, qty in by_name.items():
                parts.append(Part(name, qty, top_w, cfg.reinforce_h, "ЛДСП",
                                  dict(rail_edges), front_key="bottom"))

        # перегородки — только явные (не автоматически по числу дверей).
        # Стойка стоит между дном и крышей (не пробивает их).
        part_xs = _divider_positions(W, t, s.dividers)

        # полки — в каждом отсеке отдельно, чтобы не проходить сквозь стойку.
        # Передний торец полки виден при открытой двери/в открытой секции.
        if s.shelves > 0:
            shelf_edges = {"bottom": EF}
            if cfg.back == "none":
                shelf_edges["top"] = EI
            for cx0, cx1 in _compartments(W, t, part_xs):
                cw = round(cx1 - cx0 - 3, 1)
                if cw > 50:
                    parts.append(Part("Полка", s.shelves, cw, D - 20, "ЛДСП",
                                      dict(shelf_edges), front_key="bottom"))

        if part_xs:
            # перегородка — на всю внутреннюю высоту корпуса
            p_h = H - 2 * t - lower_rail_height(cfg)
            if p_h > 30:
                divider_edges = {"right": EF}
                if not cfg.include_roof:
                    divider_edges["top"] = EF
                if cfg.back == "none":
                    divider_edges["left"] = EI
                parts.append(Part("Перегородка", len(part_xs), D,
                                  p_h, "ЛДСП", dict(divider_edges),
                                  front_key="right"))
        if cfg.mount != "wall" and cfg.plinth_h > 0:
            legs_n += 4                   # опоры под секцией (закупные)

        # --- фасады (с авто-делением по стандарту) ---
        inner_w = _drawer_inner_width(W, t, s.dividers)
        fh_total = H - cfg.gap_top - cfg.gap_bottom
        if has_facade and s.fronts:
            # произвольная компоновка: двери и ящики в любом порядке
            for block in _custom_blocks(s, cfg, fh_total):
                if block["type"] == "doors":
                    _doors(parts, holes, s, W, block["h"],
                           cfg, count=block["count"], hinge=hinge,
                           material=facade_material)
                else:
                    for _, dh in _drawer_rows(block, cfg):
                        _drawer_front(parts, s, W, dh, cfg, material=facade_material)
            for block in _custom_blocks(s, cfg, fh_total):
                if block["type"] != "drawers":
                    continue
                for _, dh in _drawer_rows(block, cfg):
                    nbox = _split_count(W, 1, cfg, MAX_DRW_W)
                    fw = (inner_w - (nbox - 1) * cfg.gap_between) / nbox
                    for _ in range(nbox):
                        parts.extend(drawer_box(fw, dh, cfg,
                                                visible=True, runner=runner))
        elif has_facade:
            if s.drawers and s.doors:
                top_dr_h = 200.0
                door_h = fh_total - top_dr_h - cfg.gap_between
                _doors(parts, holes, s, W, door_h, cfg, hinge=hinge,
                       material=facade_material)
                _drawer_front(parts, s, W, top_dr_h, cfg,
                              material=facade_material)
            elif s.drawers:
                hs = _drawer_heights(s, cfg, fh_total)
                for dh in hs:
                    _drawer_front(parts, s, W, dh, cfg, material=facade_material)
            else:
                _doors(parts, holes, s, W, fh_total, cfg, hinge=hinge,
                       material=facade_material)

            # --- ящики (коробки на скрытых направляющих) ---
            if s.drawers:
                if s.drawers and s.doors:
                    boxes = [200.0]
                else:
                    boxes = _drawer_heights(s, cfg, fh_total)
                for dh in boxes:
                    nbox = _split_count(W, 1, cfg, MAX_DRW_W)
                    fw = (inner_w - (nbox - 1) * cfg.gap_between) / nbox
                    for _ in range(nbox):
                        parts.extend(drawer_box(fw, dh, cfg,
                                                visible=has_facade,
                                                runner=runner))

    if legs_n:
        holes.append({"part": "Ножка", "face": "-", "dia": 0, "depth": 0,
                      "note": f"опоры регулируемые: {legs_n} шт"})
    return merge_parts(parts), total_w, holes


def _doors(parts, holes, s, W, door_h, cfg, count=None,
           hinge: Hinge | None = None, material: str = "ЛДСП"):
    n = _split_count(W, count if count is not None else s.doors, cfg,
                     MAX_DOOR_W)
    fw = (W - 2 * cfg.gap_side - (n - 1) * cfg.gap_between) / n
    parts.append(Part(f"Фасад дверь ({s.label()})", n, round(fw, 1),
                      round(door_h, 1), material,
                      {"left": EF, "right": EF, "top": EF, "bottom": EF}))
    nh = hinge_count(door_h)
    off = hinge.cup_offset if hinge else HINGE_CUP_OFFSET.get(cfg.hardware, 22.5)
    name = hinge.name if hinge else cfg.hardware
    cup = hinge.cup_dia if hinge else HINGE_CUP_DIA
    holes.append({"part": f"Фасад дверь ({s.label()})", "face": "внутр. пласть",
                  "dia": cup, "depth": 12.5, "hinges": nh * n,
                  "note": f"петли {name}: {nh} шт/дверь × {n} двери, "
                          f"отступ {off:g} мм от торца"})


def _drawer_front(parts, s, W, dh, cfg, material="ЛДСП"):
    n = _split_count(W, 1, cfg, MAX_DRW_W)
    fw = (W - 2 * cfg.gap_side - (n - 1) * cfg.gap_between) / n
    parts.append(Part(f"Фасад ящик ({s.label()})", n, round(fw, 1),
                      round(dh, 1), material,
                      {"left": EF, "right": EF, "top": EF, "bottom": EF}))


# ---------------- 3D-расстановка для Blender / 2.5D ----------------
def _box(name, x, y, z, sx, sy, sz, kind, sec=0):
    return {"name": name, "x": round(x, 1), "y": round(y, 1), "z": round(z, 1),
            "sx": round(sx, 1), "sy": round(sy, 1), "sz": round(sz, 1),
            "kind": kind, "sec": sec}


def scene3d(sections, cfg: Config, open_sections=(),
             runner: Runner | None = None, cutouts=None):
    """Собрать детали в 3D (мм): X — длина, Y — глубина (0=фасад), Z — вверх.

    Двери получают ось петли (hinge), ящики — id и ход выката (open), чтобы
    Blender мог их открывать/выдвигать.
    """
    t, tb = cfg.t, cfg.t_back
    D = cfg.corpus_d
    Y0 = t                      # корпус начинается за фасадом
    Y1 = Y0 + D
    floor = cfg.mount != "wall"
    Z0 = cfg.plinth_h if floor else 0
    Z1 = Z0 + cfg.corpus_h
    total = sum(s.width for s in sections)
    boxes = []
    counter = [0]

    def new_id():
        counter[0] += 1
        return counter[0]

    if floor and cfg.worktop_t > 0:
        cuts = [c for c in (cutouts or []) if isinstance(c, dict)]
        if not cuts:
            boxes.append(_box("Столешница", 0, -20, Z1, total, D + 20,
                              cfg.worktop_t, "worktop"))
        else:
            # столешница с вырезами: прямоугольные окна под мойку/плиту
            x0, y0, x1, y1 = -20.0, -20.0, total, D
            for c in cuts:
                try:
                    cx0 = max(x0, min(x1, float(c.get("x", 0))))
                    cy0 = max(y0, min(y1, y0 + float(c.get("y", 0))))
                    cx1 = max(cx0, min(x1, cx0 + float(c.get("w", 0))))
                    cy1 = max(cy0, min(y1, cy0 + float(c.get("h", 0))))
                except (TypeError, ValueError):
                    continue
                if cx1 - cx0 < 20 or cy1 - cy0 < 20:
                    continue
                pieces = [
                    (x0, y0, cx0, y1), (cx1, y0, x1, y1),
                    (cx0, y0, cx1, cy0), (cx0, cy1, cx1, y1),
                ]
                for px0, py0, px1, py1 in pieces:
                    if px1 - px0 > 0.5 and py1 - py0 > 0.5:
                        boxes.append(_box("Столешница", px0, py0, Z1,
                                          px1 - px0, py1 - py0,
                                          cfg.worktop_t, "worktop"))
        boxes.append(_box("Цоколь", 0, 50, 0, total, 16, cfg.plinth_h,
                          "plinth"))

    def emit_doors(xs, W, z, dh, requested, sec):
        n = _split_count(W, requested, cfg, MAX_DOOR_W)
        fw = (W - 2 * cfg.gap_side - (n - 1) * cfg.gap_between) / n
        xx = xs + cfg.gap_side
        for j in range(n):
            b = _box("Фасад дверь", xx, 0, z, fw, t, dh, "door", sec)
            b["hinge"] = "left" if j % 2 == 0 else "right"
            boxes.append(b)
            xx += fw + cfg.gap_between

    def emit_drawers(xs, W, z, dh, requested, sec, comp_inner=None):
        n = _split_count(W, requested, cfg, MAX_DRW_W)
        fw = (W - 2 * cfg.gap_side - (n - 1) * cfg.gap_between) / n
        r = runner or DEFAULT_RUNNER
        run = min(r.length_for(cfg.corpus_d) - 40, 420.0)
        xx = xs + cfg.gap_side
        bl = r.length_for(cfg.corpus_d)
        bh = max(70.0, min(r.box_height, dh - 20 - r.side_extra))
        side_h = bh + r.side_extra
        by0 = t                       # сразу за фасадом
        bz0 = z + 20
        for _ in range(n):
            did = new_id()
            b = _box("Фасад ящик", xx, 0, z, fw, t, dh, "drawerfront", sec)
            b["drawer_id"] = did
            b["open"] = run
            boxes.append(b)
            # короб ящика — полый: 2 боковины + передняя и задняя стенки + дно.
            # Передняя стенка короба — опора для фасада (саморезы изнутри).
            bw = fw - 2 * r.side_gap
            if comp_inner is not None:
                bw = min(bw, comp_inner - 2 * r.side_gap)
            bx0 = xx + (fw - bw) / 2

            def dpart(name, px, py, pz, sx, sy, sz):
                b = _box(name, px, py, pz, sx, sy, sz, "drawerbox", sec)
                b["drawer_id"] = did
                b["open"] = run
                boxes.append(b)

            dpart("Ящик боковина", bx0, by0, bz0, t, bl, side_h)
            dpart("Ящик боковина", bx0 + bw - t, by0, bz0, t, bl, side_h)
            dpart("Ящик передняя стенка", bx0 + t, by0, bz0,
                  bw - 2 * t, t, bh)
            dpart("Ящик задняя стенка", bx0 + t, by0 + bl - t, bz0,
                  bw - 2 * t, t, bh)
            dpart("Ящик дно", bx0 + t, by0 + t, bz0,
                  bw - 2 * t, bl - 2 * t, t)
            xx += fw + cfg.gap_between

    x = 0.0
    for i, s in enumerate(sections):
        sec = i + 1
        W = s.width
        is_open = i in open_sections
        n_doors = _door_count(s)
        n_drawers = _drawer_count(s)
        has_facade = (n_doors + n_drawers) > 0 and not is_open
        # конструкция: накладная (стенки между крышей и дном) или вкладная
        overlay = (cfg.frame == "overlay")
        sz0 = Z0 + t if overlay else Z0
        sh = cfg.corpus_h - 2 * t if overlay else cfg.corpus_h
        topw = W if overlay else W - 2 * t
        topx = x if overlay else x + t
        boxes.append(_box("Боковина Л", x, Y0, sz0, t, D, sh, "corpus", sec))
        boxes.append(_box("Боковина П", x + W - t, Y0, sz0, t, D, sh,
                          "corpus", sec))
        if cfg.include_roof:
            boxes.append(_box("Крыша", topx, Y0, Z1 - t, topw, D, t,
                              "corpus", sec))
        boxes.append(_box("Дно", topx, Y0, Z0, topw, D, t, "corpus", sec))
        bt = back_thickness(cfg)
        if bt > 0:
            boxes.append(_box("Задняя стенка", x, Y1, Z0, W, bt,
                              cfg.corpus_h, "back", sec))
        for r in reinforce_layout(cfg):
            boxes.append(_box(r["name"], x + t, Y0 + r["y"], Z0 + r["z"],
                              W - 2 * t, cfg.reinforce_h, t, "corpus", sec))
        # зона полок и стоек: между дном и крышей; если сверху ящики —
        # только под дверью, чтобы не пробивать короб ящика
        pz0 = Z0 + t + lower_rail_height(cfg)
        pz1 = Z1 - t
        if s.fronts:
            z = _door_zone(s, cfg, cfg.corpus_h - cfg.gap_top - cfg.gap_bottom)
            if z:
                pz0 = max(Z0 + t + lower_rail_height(cfg),
                          Z0 + cfg.gap_bottom + z[0])
                pz1 = Z0 + cfg.gap_bottom + z[0] + z[1]
                if pz1 - pz0 < 30:
                    pz1 = pz0
            else:
                pz1 = pz0
        if has_facade and s.doors and s.drawers:
            fh = cfg.corpus_h - cfg.gap_top - cfg.gap_bottom
            pz1 = Z0 + cfg.gap_bottom + fh - 200.0 - cfg.gap_between
            if pz1 - pz0 < 100:
                pz1 = Z1 - t

        # перегородки — только явные (число дверей их не добавляет).
        # Стойка идёт на всю внутреннюю высоту, а не только в зоне полок.
        part_xs = _divider_positions(W, t, s.dividers)
        dz0 = Z0 + t + lower_rail_height(cfg)
        dz1 = Z1 - t
        for bx in part_xs:
            boxes.append(_box("Перегородка", x + bx, Y0, dz0, t, D,
                              dz1 - dz0, "corpus", sec))

        if s.shelves > 0:
            zone_h = pz1 - pz0
            for cx0, cx1 in _compartments(W, t, part_xs):
                for k in range(s.shelves):
                    zz = pz0 + (k + 1) * zone_h / (s.shelves + 1)
                    boxes.append(_box("Полка", x + cx0, Y0, zz - t / 2,
                                      cx1 - cx0, D - 20, t, "corpus", sec))
        # опоры (регулируемые ножки) под секцией
        if floor and cfg.plinth_h > 0:
            for lx in (x + 40, x + W - 90):
                for ly in (Y0 + 66, Y1 - 90):
                    boxes.append(_box("Ножка", lx, ly, 0, 50, 50, cfg.plinth_h,
                                      "leg", sec))
        if has_facade:
            fh = cfg.corpus_h - cfg.gap_top - cfg.gap_bottom
            zb = Z0 + cfg.gap_bottom
            if s.fronts:
                for block in _custom_blocks(s, cfg, fh):
                    z0 = zb + block["z0"]
                    if block["type"] == "doors":
                        emit_doors(x, W, z0, block["h"], block["count"], sec)
                    else:
                        for rz, rh in _drawer_rows(block, cfg):
                            emit_drawers(x, W, zb + rz, rh, 1, sec, _drawer_inner_width(W, t, s.dividers))
            elif s.drawers and s.doors:
                top = 200.0
                emit_drawers(x, W, zb + fh - top, top, 1, sec, _drawer_inner_width(W, t, s.dividers))
                emit_doors(x, W, zb, fh - top - cfg.gap_between, s.doors, sec)
            elif s.drawers:
                hs = _drawer_heights(s, cfg, fh)
                zz = zb
                for dh in hs:
                    emit_drawers(x, W, zz, dh, 1, sec, _drawer_inner_width(W, t, s.dividers))
                    zz += dh + cfg.gap_between
            else:
                emit_doors(x, W, zb, fh, s.doors, sec)
        x += W
    return boxes
