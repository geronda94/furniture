"""Карта присадки и сборки.

Модуль не меняет геометрию: он читает уже рассчитанные коробки scene3d и
превращает их в операции присадки с локальными координатами деталей.

Координаты операции:
  x, y — на пласти детали, от выбранной базы (см. поле basis);
  стороны и «ПЕРЕД» задаются отдельно.

Значения отверстий берутся из specs/hardware.yaml. Если для направляющих
нет заводского шаблона, операция помечается requires_pattern и не выдаётся
за точное отверстие.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .config import Config
from .hardware import (
    Fastener,
    GasStrut,
    Handle,
    LegMount,
    Hinge,
    Runner,
    ShelfSupport,
    edge_type_for,
    EdgeType,
)
from .parts import hinge_count

EDGE_WARN_MIN = 4.0       # минимальный запас до кромки для отверстия, мм
MAX_WARNINGS = 24


@dataclass
class Box:
    name: str
    x: float
    y: float
    z: float
    sx: float
    sy: float
    sz: float
    kind: str = "corpus"
    sec: int = 0
    hinge: str = ""
    drawer_id: int | None = None

    @property
    def cx(self) -> float:
        return self.x + self.sx / 2

    @property
    def cy(self) -> float:
        return self.y + self.sy / 2

    @property
    def cz(self) -> float:
        return self.z + self.sz / 2


def _boxes(raw: Iterable[dict]) -> list[Box]:
    out: list[Box] = []
    for b in raw:
        if not isinstance(b, dict):
            continue
        try:
            out.append(Box(
                name=str(b.get("name", "")),
                x=float(b.get("x", 0)),
                y=float(b.get("y", 0)),
                z=float(b.get("z", 0)),
                sx=float(b.get("sx", 0)),
                sy=float(b.get("sy", 0)),
                sz=float(b.get("sz", 0)),
                kind=str(b.get("kind", "corpus")),
                sec=int(b.get("sec", 0)),
                hinge=str(b.get("hinge", "")),
                drawer_id=b.get("drawer_id"),
            ))
        except (TypeError, ValueError):
            continue
    return out


def _kind(name: str) -> str:
    if name.startswith("Боковина"):
        return "side"
    if name in ("Крыша", "Дно"):
        return "horizontal"
    if name == "Перегородка":
        return "divider"
    if name == "Полка":
        return "shelf"
    if name == "Фасад дверь":
        return "door"
    if name == "Фасад ящик":
        return "drawer_front"
    if name == "Ящик боковина":
        return "drawer_side"
    if name == "Ящик передняя стенка":
        return "drawer_panel"
    if name == "Задняя стенка":
        return "back"
    if name == "Ножка":
        return "leg"
    if name == "Цоколь":
        return "plinth"
    if name == "Столешница":
        return "worktop"
    return "other"


# имя коробки в 3D → имя позиции в деталировке (BOM)
ALIAS = {
    "Боковина Л": "Боковина лев.",
    "Боковина П": "Боковина прав.",
}


def _part_name(box: Box) -> str:
    return ALIAS.get(box.name, box.name)


BASIS = {
    "side": "x — от передней кромки (глубина), y — от низа",
    "horizontal": "x — от левого торца, y — от передней кромки (глубина)",
    "divider": "x — от передней кромки (глубина), y — от низа",
    "shelf": "x — от левого торца, y — от передней кромки",
    "door": "x — от левого торца, y — от низа",
    "drawer_front": "x — от левого торца, y — от низа",
    "drawer_side": "x — от передней кромки, y — от низа",
    "drawer_panel": "x — от левого торца, y — от низа",
}


def _op(
    *,
    part: str,
    part_kind: str,
    face: str,
    x: float,
    y: float,
    dia: float,
    depth: float,
    kind: str,
    hardware: str,
    hardware_id: str,
    section: int,
    qty: int = 1,
    note: str = "",
    visibility: str = "hidden",
    requires_pattern: bool = False,
    unit: str = "",
    joint: str = "",
    joint_class: str = "",
    edge_side: str = "",
) -> dict:
    return {
        "part": part,
        "part_kind": part_kind,
        "face": face,
        "x": round(x, 1),
        "y": round(y, 1),
        "dia": round(dia, 1),
        "depth": round(depth, 1),
        "kind": kind,
        "hardware": hardware,
        "hardware_id": hardware_id,
        "section": section,
        "qty": qty,
        "visibility": visibility,
        "requires_pattern": requires_pattern,
        "unit": unit,
        "joint": joint,
        "joint_class": joint_class,
        "edge_side": edge_side,
        "note": note,
        "basis": BASIS.get(part_kind, "x — от левого края, y — от низа"),
    }


def _hinge_ys(h: float, hinge: Hinge) -> list[float]:
    n = hinge_count(h)
    margin = max(25.0, min(hinge.edge_margin, h / 2 - 10))
    if n <= 1:
        return [h / 2]
    if n == 2:
        return [margin, h - margin]
    top = max(margin, h - margin)
    return [margin + (top - margin) * i / (n - 1) for i in range(n)]


def _snap32(y: float, low: float, high: float) -> float:
    """Ближайшее отверстие сетки System 32 (первый ряд — 32 мм)."""
    grid = round((y - 32.0) / 32.0) * 32.0 + 32.0
    grid = max(low, min(high, grid))
    return grid


def _support_xs(side: Box, support: ShelfSupport) -> list[float]:
    d = side.sy
    off = support.offset
    if support.x_mode == "front":
        return [off]
    if support.x_mode == "rear":
        return [d - off]
    if support.x_mode == "center":
        return [d / 2]
    return [off, d - off]


def _handle_centers(box: Box, handle: Handle, *, is_drawer: bool,
                    hinge: str) -> list[float]:
    """Центры ручек по X (0..ширина створки/фасада)."""
    if is_drawer:
        if handle.two_above_width and box.sx > handle.two_above_width:
            return [box.sx * 0.25, box.sx * 0.75]
        return [box.sx / 2]
    # отступ door_margin — до ближайшего отверстия, а не до центра ручки
    inset = handle.door_margin + handle.centers / 2
    if hinge == "left":
        # петля слева → ручка у правого края открывания
        return [box.sx - inset]
    return [inset]


def _handle_holes(
    box: Box,
    handle: Handle,
    *,
    is_drawer: bool,
    hinge: str,
    section: int,
    detail: str,
) -> list[dict]:
    if handle.mount == "profile" or handle.centers < 0:
        return []
    y = box.sz / 2 if is_drawer else max(
        handle.hole_dia, box.sz - handle.door_top)
    out: list[dict] = []
    for hi, base_x in enumerate(_handle_centers(
            box, handle, is_drawer=is_drawer, hinge=hinge), start=1):
        if handle.centers <= 0:
            xs = [base_x]
        else:
            xs = [base_x - handle.centers / 2, base_x + handle.centers / 2]
        for x in xs:
            x = max(handle.hole_dia / 2 + 2,
                    min(box.sx - handle.hole_dia / 2 - 2, x))
            out.append(_op(
                part=_part_name(box), part_kind=_kind(box.name),
                face="наружная пласть", x=x, y=y,
                dia=handle.hole_dia, depth=handle.hole_depth,
                kind="handle", hardware=handle.name,
                hardware_id=handle.id, section=section,
                note=f"{detail}; ручка {handle.name}, межцентровое "
                     f"{handle.centers:g} мм",
                visibility="visible",
                unit=f"{detail}-h{hi}",
            ))
    return out


def _joint(
    *,
    face_box: Box,
    face_x: float,
    face_y: float,
    end_box: Box,
    end_x: float,
    end_note: str,
    fastener: Fastener,
    note: str,
    joint: str = "",
    joint_class: str = "",
    end_side: str = "",
) -> list[dict]:
    """Соединение пласти одной детали с торцом другой."""
    fk = _kind(face_box.name)
    ek = _kind(end_box.name)
    return [
        _op(
            part=_part_name(face_box), part_kind=fk,
            face="внутренняя пласть", x=face_x, y=face_y,
            dia=fastener.face_dia, depth=fastener.face_depth,
            kind="fastener_face", hardware=fastener.name,
            hardware_id=fastener.id, section=face_box.sec,
            note=f"{note}: {fastener.name} — отверстие в пласти. "
                 f"{fastener.note}",
            visibility=fastener.visibility,
            joint=joint, joint_class=joint_class,
        ),
        _op(
            part=_part_name(end_box), part_kind=ek,
            face="торец", x=end_x, y=0,
            dia=fastener.pilot_dia, depth=fastener.pilot_depth,
            kind="fastener_end", hardware=fastener.name,
            hardware_id=fastener.id, section=end_box.sec,
            note=f"{note}: {end_note}",
            visibility=fastener.visibility,
            joint=joint, joint_class=joint_class,
            edge_side=end_side,
        ),
    ]


def build_operations(
    raw_boxes: Iterable[dict],
    cfg: Config,
    *,
    runner: Runner,
    hinge: Hinge,
    handle: Handle,
    fastener: Fastener | None = None,
    fasteners: list[Fastener] | None = None,
    shelf_support: ShelfSupport | None = None,
    gas_strut: GasStrut | None = None,
    leg_mount: LegMount | None = None,
    edge_types: list[EdgeType] | None = None,
    params: dict | None = None,
) -> list[dict]:
    """Собрать точные операции присадки по готовым 3D-коробкам."""
    boxes = _boxes(raw_boxes)
    params = params or {}
    out: list[dict] = []

    fastener_list = list(fasteners or [])
    if fastener is None:
        from .hardware import load_fasteners
        fastener = load_fasteners()[0]
    if fastener.id not in {f.id for f in fastener_list}:
        fastener_list.insert(0, fastener)

    def pick_fastener(cls: str) -> Fastener:
        rules = params.get("connectionOverrides") or {}
        fid = rules.get(cls) or params.get("fastener") or "auto"
        if fid in ("auto", "", None):
            fid = "minifix" if params.get("hiddenFasteners") else "confirmat"
        for f in fastener_list:
            if f.id == fid:
                return f
        return fastener
    if shelf_support is None:
        from .hardware import load_shelf_supports
        shelf_support = load_shelf_supports()[0]

    sides = [b for b in boxes if _kind(b.name) == "side"]
    horizontals = [b for b in boxes if _kind(b.name) == "horizontal"]
    dividers = [b for b in boxes if _kind(b.name) == "divider"]
    shelves = [b for b in boxes if _kind(b.name) == "shelf"]
    doors = [b for b in boxes if _kind(b.name) == "door"]
    drawer_fronts = [b for b in boxes if _kind(b.name) == "drawer_front"]
    drawer_sides = [b for b in boxes if _kind(b.name) == "drawer_side"]
    system32 = bool(params.get("system32", True))

    def side_of(sec: int, left: bool) -> Box | None:
        for s in sides:
            if s.sec != sec:
                continue
            if left and s.name.endswith("Л"):
                return s
            if not left and s.name.endswith("П"):
                return s
        return None

    # 1. Корпус: крыша/дно ↔ боковины (по 2 крепления на соединение).
    for h in horizontals:
        for left in (True, False):
            side = side_of(h.sec, left)
            if not side:
                continue
            y = h.cz - side.z
            if y < 0 or y > side.sz:
                continue
            for depth in (37.0, side.sy - 37.0):
                out += _joint(
                    face_box=side, face_x=depth, face_y=y,
                    end_box=h, end_x=depth,
                    end_note="пилот в торец крыши/дна",
                    fastener=pick_fastener("carcass"),
                    note=f"{h.name} ↔ {side.name}",
                    joint=f"{h.name} ↔ {side.name}",
                    joint_class="carcass",
                    end_side="left" if side.name.endswith("Л") else "right",
                )

    # 2. Перегородки ↔ крыша/дно (по 2 крепления с каждого торца).
    for d in dividers:
        for h in (b for b in horizontals if b.sec == d.sec):
            for depth in (37.0, d.sy - 37.0):
                out += _joint(
                    face_box=h,
                    face_x=d.cx - h.x,
                    face_y=depth,
                    end_box=d,
                    end_x=depth,
                    end_note="пилот в торец перегородки",
                    fastener=pick_fastener("divider"),
                    note=f"{h.name} ↔ {d.name}",
                    joint=f"{h.name} ↔ {d.name}",
                    joint_class="divider",
                    end_side="top" if h.name == "Крыша" else "bottom",
                )

    # 3. Полкодержатели. System 32 — техническая сетка; в карту попадают
    # только реально используемые отверстия, а не весь резерв.
    for shelf in shelves:
        for left in (True, False):
            side = side_of(shelf.sec, left)
            if not side or side.sz <= 64 or side.sy <= 64:
                continue
            y = shelf.cz - side.z
            if y < 20 or y > side.sz - 20:
                continue
            on_grid = False
            if shelf_support.id == "system32":
                if system32:
                    y = _snap32(y, 32.0, side.sz - 32.0)
                    on_grid = True
                suffix = " (ряд System 32)" if on_grid else ""
            else:
                suffix = ""
            for x in _support_xs(side, shelf_support):
                out.append(_op(
                    part=_part_name(side), part_kind="side",
                    face="внутренняя пласть", x=x, y=y,
                    dia=shelf_support.hole_dia,
                    depth=shelf_support.depth,
                    kind="shelf_pin", hardware=shelf_support.name,
                    hardware_id=shelf_support.id, section=shelf.sec,
                    note=f"полка: {shelf_support.name}{suffix}. "
                         f"{shelf_support.note}",
                ))

    # Полкодержатели в перегородках (обе пласти), если полка к ним примыкает.
    for shelf in shelves:
        for d in (x for x in dividers if x.sec == shelf.sec):
            y = shelf.cz - d.z
            if y < 20 or y > d.sz - 20:
                continue
            xs = (_support_xs(d, shelf_support)
                  if shelf_support.id != "system32"
                  else [37.0, d.sy - 37.0])
            if shelf_support.id == "system32":
                y = _snap32(y, 32.0, d.sz - 32.0)
            for x in xs:
                out.append(_op(
                    part=_part_name(d), part_kind="divider",
                    face="внутренняя пласть (обе стороны)", x=x, y=y,
                    dia=shelf_support.hole_dia, depth=shelf_support.depth,
                    kind="shelf_pin", hardware=shelf_support.name,
                    hardware_id=shelf_support.id, section=shelf.sec,
                    qty=2,
                    note=f"полка; сверлить с двух сторон перегородки. "
                         f"{shelf_support.note}",
                ))

    # 4. Петли: чашка на двери + ответная планка на боковине.
    for i, door in enumerate(doors, start=1):
        ys = _hinge_ys(door.sz, hinge)
        left = door.hinge != "right"
        cup_x = hinge.cup_offset if left else door.sx - hinge.cup_offset
        for k, y in enumerate(ys, start=1):
            out.append(_op(
                part=_part_name(door), part_kind="door",
                face="внутренняя пласть", x=cup_x, y=y,
                dia=hinge.cup_dia, depth=hinge.cup_depth,
                kind="hinge_cup", hardware=hinge.name,
                hardware_id=hinge.id, section=door.sec,
                note=f"створка {i}, петля {k}/{len(ys)}; "
                     f"сторона {'левая' if left else 'правая'}",
            ))
            side = side_of(door.sec, left)
            if side:
                world_y = door.z + y - side.z
                plate_x = min(hinge.plate_offset, side.sy - 10)
                for dy in (-hinge.plate_pitch / 2, hinge.plate_pitch / 2):
                    out.append(_op(
                        part=_part_name(side), part_kind="side",
                        face="внутренняя пласть", x=plate_x,
                        y=world_y + dy,
                        dia=5.0, depth=13.0, kind="hinge_plate",
                        hardware=hinge.name, hardware_id=hinge.id,
                        section=side.sec,
                        note=f"ответная планка, створка {i}, петля {k}",
                    ))

    # 5. Ручки на дверях и фасадах ящиков.
    for i, door in enumerate(doors, start=1):
        out += _handle_holes(
            door, handle, is_drawer=False, hinge=door.hinge,
            section=door.sec, detail=f"дверь {i}",
        )
    for i, front in enumerate(drawer_fronts, start=1):
        out += _handle_holes(
            front, handle, is_drawer=True, hinge="",
            section=front.sec, detail=f"ящик {i}",
        )

    # 6. Направляющие ящиков.
    seen: set[int] = set()
    for b in drawer_sides:
        did = b.drawer_id
        if did is None or did in seen:
            continue
        seen.add(did)
        left_side = side_of(b.sec, True)
        right_side = side_of(b.sec, False)
        center_y = b.cz
        if runner.template and runner.body_holes:
            for side in (left_side, right_side):
                if not side:
                    continue
                y = center_y - side.z
                for hole in runner.body_holes:
                    x = (float(hole.get("offset", 37.0))
                         if hole.get("from", "front") == "front"
                         else side.sy - float(hole.get("offset", 37.0)))
                    out.append(_op(
                        part=_part_name(side), part_kind="side",
                        face="внутренняя пласть", x=x, y=y,
                        dia=float(hole.get("dia", 5.0)),
                        depth=float(hole.get("depth", 13.0)),
                        kind="slide_mount", hardware=runner.name,
                        hardware_id=runner.id, section=side.sec,
                        note=f"направляющая {runner.name}: "
                             f"{hole.get('from', 'front')} "
                             f"{float(hole.get('offset', 37)):g} мм",
                    ))
            for hole in runner.box_holes:
                x = (float(hole.get("offset", 37.0))
                     if hole.get("from", "front") == "front"
                     else b.sy - float(hole.get("offset", 37.0)))
                out.append(_op(
                    part=_part_name(b), part_kind="drawer_side",
                    face="наружная пласть", x=x, y=b.sz / 2,
                    dia=float(hole.get("dia", 5.0)),
                    depth=float(hole.get("depth", 13.0)),
                    kind="slide_box", hardware=runner.name,
                    hardware_id=runner.id, section=b.sec,
                    note=f"направляющая {runner.name}: отверстие в борту "
                         f"ящика (зеркально для второго борта)",
                ))
        else:
            for side in (left_side, right_side):
                if not side:
                    continue
                out.append(_op(
                    part=_part_name(side), part_kind="side",
                    face="внутренняя пласть", x=37.0,
                    y=center_y - side.z,
                    dia=0.0, depth=0.0, kind="slide_mount",
                    hardware=runner.name, hardware_id=runner.id,
                    section=side.sec,
                    note=f"направляющие {runner.name}: сверить отверстия "
                         f"по шаблону производителя; {runner.note}",
                    requires_pattern=True,
                ))

    # 7. Газовые патроны: верхняя створка секции.
    if gas_strut:
        top_doors: dict[int, Box] = {}
        for door in doors:
            prev = top_doors.get(door.sec)
            if prev is None or door.z + door.sz > prev.z + prev.sz:
                top_doors[door.sec] = door
        for sec, door in top_doors.items():
            left = door.hinge != "right"
            side = side_of(sec, left)
            if not side:
                continue
            out.append(_op(
                part=_part_name(side), part_kind="side",
                face="внутренняя пласть",
                x=min(gas_strut.body_offset_x, side.sy - 10),
                y=max(10.0, side.sz - gas_strut.body_offset_top),
                dia=gas_strut.hole_dia, depth=gas_strut.hole_depth,
                kind="gas_strut", hardware=gas_strut.name,
                hardware_id=gas_strut.id, section=sec,
                note=f"газовый патрон {gas_strut.name}: крепление к "
                     f"боковине; {gas_strut.note}",
                requires_pattern=not gas_strut.template,
            ))
            out.append(_op(
                part=_part_name(door), part_kind="door",
                face="внутренняя пласть",
                x=(gas_strut.door_offset_x if left
                   else door.sx - gas_strut.door_offset_x),
                y=max(10.0, gas_strut.door_offset_bottom),
                dia=gas_strut.hole_dia, depth=gas_strut.hole_depth,
                kind="gas_strut", hardware=gas_strut.name,
                hardware_id=gas_strut.id, section=sec,
                note=f"газовый патрон {gas_strut.name}: крепление к створке "
                     f"(до {gas_strut.door_weight_max:g} кг); "
                     f"{gas_strut.note}",
                requires_pattern=not gas_strut.template,
            ))

    # 8. Крепление фасадов ящиков: саморезы изнутри короба.
    for panel in (b for b in boxes if _kind(b.name) == "drawer_panel"):
        if panel.sx < 90 or panel.sz < 90:
            continue
        margin = 40.0
        for x in (margin, panel.sx - margin):
            for y in (margin, panel.sz - margin):
                out.append(_op(
                    part=_part_name(panel), part_kind="drawer_panel",
                    face="внутренняя пласть", x=x, y=y,
                    dia=4.0, depth=12.0, kind="screw_front",
                    hardware="Саморез 4×30", hardware_id="screw-4x30",
                    section=panel.sec,
                    note="крепление фасада ящика изнутри короба",
                    visibility="hidden", joint="Фасад ящика ↔ короб",
                    joint_class="drawer",
                ))

    # 9. Крепление опор/колёс к дну: отверстия на нижней пласти.
    if leg_mount and leg_mount.holes:
        bottoms = [b for b in boxes if b.name == "Дно"]
        for leg in (b for b in boxes if _kind(b.name) == "leg"):
            bottom = next((b for b in bottoms if b.sec == leg.sec), None)
            if not bottom:
                continue
            cx = leg.cx - bottom.x
            cy = leg.cy - bottom.y
            for h in leg_mount.holes:
                try:
                    dx = float(h.get("dx", 0))
                    dy = float(h.get("dy", 0))
                except (TypeError, ValueError):
                    continue
                out.append(_op(
                    part=_part_name(bottom), part_kind="horizontal",
                    face="наружная пласть (снизу)",
                    x=cx + dx, y=cy + dy,
                    dia=leg_mount.hole_dia, depth=leg_mount.depth,
                    kind="leg_mount", hardware=leg_mount.name,
                    hardware_id=leg_mount.id, section=leg.sec,
                    note=f"крепление опоры: {leg_mount.name}. "
                         f"{leg_mount.note}",
                    requires_pattern=not leg_mount.template,
                ))

    # Стабильный ключ для UI (без случайных id).
    for n, op in enumerate(out, start=1):
        op["id"] = f"op-{n}"
    return out


def part_size(box: Box) -> tuple[float, float]:
    k = _kind(box.name)
    if k in ("side", "divider", "drawer_side"):
        return box.sy, box.sz
    if k in ("horizontal", "shelf"):
        return box.sx, box.sy
    return box.sx, box.sz


def validate_operations(
    operations: list[dict],
    raw_boxes: Iterable[dict],
    *,
    hinge: Hinge,
    handle: Handle,
) -> list[str]:
    """Проверить, что отверстия не выходят за деталь и не рвут кромку."""
    sizes: dict[str, tuple[float, float]] = {}
    for b in _boxes(raw_boxes):
        sizes.setdefault(_part_name(b), part_size(b))
    warn: list[str] = []
    seen: set[str] = set()
    for op in operations:
        name = str(op.get("part"))
        size = sizes.get(name)
        if not size:
            continue
        w, h = size
        dia = float(op.get("dia") or 0)
        if not dia or op.get("face") == "торец":
            continue
        x, y = float(op.get("x") or 0), float(op.get("y") or 0)
        r = dia / 2
        if x - r < -0.5 or y - r < -0.5 or x + r > w + 0.5 or y + r > h + 0.5:
            msg = (f"Присадка: {name} — отверстие Ø{dia:g} ({x:g};{y:g}) "
                   f"выходит за деталь {w:g}×{h:g}")
            if msg not in seen:
                seen.add(msg)
                warn.append(msg)
            continue
        margin = min(x - r, y - r, w - x - r, h - y - r)
        if 0 <= margin < EDGE_WARN_MIN and op.get("kind") not in (
                "hinge_cup", "fastener_face", "fastener_end"):
            msg = (f"Присадка: {name} — до кромки {margin:.1f} мм "
                   f"(< {EDGE_WARN_MIN:g} мм), Ø{dia:g}")
            if msg not in seen:
                seen.add(msg)
                warn.append(msg)
        if len(warn) >= MAX_WARNINGS:
            break
    return warn


def summarize(
    operations: list[dict],
    runner: Runner,
    handle: Handle,
    hinge: Hinge,
    *,
    fastener: Fastener | None = None,
    fasteners: list[Fastener] | None = None,
    shelf_support: ShelfSupport | None = None,
    gas_strut: GasStrut | None = None,
    leg_mount: LegMount | None = None,
    edge_types: list[EdgeType] | None = None,
) -> dict:
    def count(kind: str) -> int:
        return sum(int(o.get("qty", 1)) for o in operations
                   if o.get("kind") == kind)

    fasteners = count("fastener_face")
    screws = count("screw_front")
    leg_holes = count("leg_mount")
    joint_rows: dict[str, dict] = {}
    for o in operations:
        if o.get("kind") != "fastener_face" or not o.get("joint"):
            continue
        key = str(o["joint"])
        row = joint_rows.setdefault(key, {
            "joint": key,
            "class": o.get("joint_class", ""),
            "fastener": o.get("hardware", ""),
            "fastener_id": o.get("hardware_id", ""),
            "count": 0,
        })
        row["count"] += int(o.get("qty", 1))
    handle_units = len({str(o.get("unit")) for o in operations
                        if o.get("kind") == "handle" and o.get("unit")})
    gas_units = count("gas_strut") // 2
    edge_map: dict[str, dict] = {}
    for t in edge_types or []:
        edge_map[t.price_key] = {"id": t.id, "name": t.name,
                                 "thickness": t.thickness, "color": t.color}
    return {
        "hinge_model": hinge.name,
        "hinge_id": hinge.id,
        "handle_model": handle.name,
        "handle_id": handle.id,
        "runner_model": runner.name,
        "runner_id": runner.id,
        "runner_template": runner.template,
        "fastener_model": fastener.name if fastener else "",
        "fastener_id": fastener.id if fastener else "",
        "shelf_support_model": shelf_support.name if shelf_support else "",
        "shelf_support_id": shelf_support.id if shelf_support else "",
        "gas_strut_model": gas_strut.name if gas_strut else "",
        "gas_strut_id": gas_strut.id if gas_strut else "",
        "hinges": count("hinge_cup"),
        "hinge_plates": count("hinge_plate"),
        "handles": handle_units,
        "handle_holes": count("handle"),
        "fasteners": fasteners,
        "screws": screws,
        "leg_holes": leg_holes,
        "joints": sorted(joint_rows.values(), key=lambda r: r["joint"]),
        "confirmats": fasteners,          # совместимость со старым UI
        "shelf_pins": count("shelf_pin"),
        "system32_holes": 0,  # техническая сетка не показывается в карте
        "slide_mounts": count("slide_mount"),
        "slide_box_holes": count("slide_box"),
        "gas_struts": gas_units,
        "visible_fasteners": sum(
            int(o.get("qty", 1)) for o in operations
            if o.get("kind") in ("fastener_face", "fastener_end")
            and o.get("visibility") == "visible"),
        "requires_pattern": sum(1 for o in operations
                                if o.get("requires_pattern")),
        "edge_types": edge_map,
    }


__all__ = [
    "Box", "build_operations", "summarize", "validate_operations",
    "edge_type_for",
]
