"""Карта присадки и сборки.

Модуль не меняет геометрию: он читает уже рассчитанные коробки scene3d и
превращает их в операции присадки с локальными координатами деталей.

Координаты операции:
  x — от левого края пласти (ширина/глубина детали);
  y — от нижнего края (высота/глубина);
  стороны и «ПЕРЕД» задаются отдельно.

Значения отверстий берутся из specs/hardware.yaml. Если для направляющих
нет заводского шаблона, операция помечается requires_pattern и не выдаётся
за точное отверстие.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .config import Config
from .hardware import Handle, Hinge, Runner
from .parts import hinge_count


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


def _op(
    *,
    part: str,
    face: str,
    x: float,
    y: float,
    dia: float,
    depth: float,
    kind: str,
    hardware: str,
    section: int,
    qty: int = 1,
    note: str = "",
    visibility: str = "hidden",
    requires_pattern: bool = False,
) -> dict:
    return {
        "part": part,
        "face": face,
        "x": round(x, 1),
        "y": round(y, 1),
        "dia": round(dia, 1),
        "depth": round(depth, 1),
        "kind": kind,
        "hardware": hardware,
        "section": section,
        "qty": qty,
        "visibility": visibility,
        "requires_pattern": requires_pattern,
        "note": note,
        "coord": "x — слева, y — снизу; координаты на пласти детали",
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


def _handle_holes(
    box: Box,
    handle: Handle,
    *,
    is_drawer: bool,
    section: int,
    detail: str,
) -> list[dict]:
    if handle.mount == "profile" or handle.centers < 0:
        return []
    # Вертикальные ручки-рейлинги и профили не сверлятся этим шаблоном.
    margin = 60.0
    y = box.sz / 2 if is_drawer else max(35.0, box.sz - margin)
    if handle.centers <= 0:
        xs = [box.sx / 2]
    else:
        xs = [(box.sx - handle.centers) / 2,
              (box.sx + handle.centers) / 2]
    out = []
    for x in xs:
        out.append(_op(
            part=box.name, face="наружная пласть", x=x, y=y,
            dia=handle.hole_dia, depth=handle.hole_depth,
            kind="handle", hardware=handle.name, section=section,
            note=f"{detail}; ручка {handle.name}, межцентровое "
                 f"{handle.centers:g} мм",
            visibility="visible",
        ))
    return out


def build_operations(
    raw_boxes: Iterable[dict],
    cfg: Config,
    *,
    runner: Runner,
    hinge: Hinge,
    handle: Handle,
) -> list[dict]:
    """Собрать точные операции присадки по готовым 3D-коробкам."""
    boxes = _boxes(raw_boxes)
    out: list[dict] = []

    sides = [b for b in boxes if b.name.startswith("Боковина")]
    tops = [b for b in boxes if b.name in ("Крыша", "Дно")]
    shelves = [b for b in boxes if b.name == "Полка"]
    doors = [b for b in boxes if b.name == "Фасад дверь"]
    drawer_fronts = [b for b in boxes if b.name == "Фасад ящик"]
    drawer_sides = [b for b in boxes if b.name == "Ящик боковина"]

    # System 32: два ряда по глубине на каждой боковине.
    for side in sides:
        if side.sx <= 0 or side.sz <= 40:
            continue
        y = 32.0
        while y <= side.sz - 32.0 + 0.1:
            for x in (37.0, side.sy - 37.0):
                out.append(_op(
                    part=side.name, face="внутренняя пласть", x=x, y=y,
                    dia=5.0, depth=13.0, kind="system32",
                    hardware="System 32", section=side.sec,
                    note="ряд полкодержателей / ответных планок",
                ))
            y += 32.0

    # Конфирматы крыши и дна к боковинам.
    for top in tops:
        for side in (s for s in sides if s.sec == top.sec):
            if abs(side.x - top.x) > max(side.sx, top.sx) + 1:
                continue
            y = (top.z + top.sz / 2) - side.z
            if y < 0 or y > side.sz:
                continue
            for x in (37.0, side.sy - 37.0):
                out.append(_op(
                    part=side.name, face="внутренняя пласть", x=x, y=y,
                    dia=7.0, depth=13.0, kind="confirmat_face",
                    hardware="Конфирмат 7×50", section=side.sec,
                    note=f"{top.name}: зенковка под конфирмат",
                ))
            out.append(_op(
                part=top.name, face="торец", x=37, y=0,
                dia=5.0, depth=34.0, kind="confirmat_pilot",
                hardware="Конфирмат 7×50", section=top.sec,
                note="пилот Ø5 в торец крыши/дна",
            ))

    # Петли: чашка на двери + ответная планка на боковине.
    for i, door in enumerate(doors, start=1):
        ys = _hinge_ys(door.sz, hinge)
        left = door.hinge != "right"
        cup_x = hinge.cup_offset if left else door.sx - hinge.cup_offset
        for k, y in enumerate(ys, start=1):
            out.append(_op(
                part=door.name, face="внутренняя пласть", x=cup_x, y=y,
                dia=hinge.cup_dia, depth=hinge.cup_depth,
                kind="hinge_cup", hardware=hinge.name, section=door.sec,
                note=f"створка {i}, петля {k}/{len(ys)}; "
                     f"сторона {'левая' if left else 'правая'}",
            ))
            side = next(
                (s for s in sides if s.sec == door.sec and
                 (s.name.endswith("Л") if left else s.name.endswith("П"))),
                None,
            )
            if side:
                world_y = door.z + y - side.z
                plate_x = min(hinge.plate_offset, side.sy - 10)
                for dy in (-16.0, 16.0):
                    out.append(_op(
                        part=side.name, face="внутренняя пласть",
                        x=plate_x, y=world_y + dy,
                        dia=5.0, depth=13.0, kind="hinge_plate",
                        hardware=hinge.name, section=side.sec,
                        note=f"ответная планка, створка {i}, петля {k}",
                    ))

    # Ручки на дверях и фасадах ящиков.
    for i, door in enumerate(doors, start=1):
        out += _handle_holes(
            door, handle, is_drawer=False, section=door.sec,
            detail=f"дверь {i}",
        )
    for i, front in enumerate(drawer_fronts, start=1):
        out += _handle_holes(
            front, handle, is_drawer=True, section=front.sec,
            detail=f"ящик {i}",
        )

    # Полкодержатели: по два отверстия с каждой стороны под полкой.
    for shelf in shelves:
        left = next((s for s in sides if s.sec == shelf.sec and
                     s.name.endswith("Л")), None)
        right = next((s for s in sides if s.sec == shelf.sec and
                      s.name.endswith("П")), None)
        if not left and not right:
            continue
        for side in (left, right):
            if not side:
                continue
            y = (shelf.z + shelf.sz / 2) - side.z
            if y < 20 or y > side.sz - 20:
                continue
            for x in (37.0, side.sy - 37.0):
                out.append(_op(
                    part=side.name, face="внутренняя пласть", x=x, y=y,
                    dia=5.0, depth=13.0, kind="shelf_pin",
                    hardware="Полкодержатель System 32", section=side.sec,
                    note="полка: опора на полкодержатели",
                ))

    # Направляющие: положение короба известно, но заводской шаблон отверстий
    # зависит от конкретной модели. Поэтому операция честно помечается как
    # требующая шаблона, а не выдаётся за готовую присадку.
    seen: set[int] = set()
    for b in drawer_sides:
        did = b.drawer_id
        if did is None or did in seen:
            continue
        seen.add(did)
        side = next((s for s in sides if s.sec == b.sec and
                     s.name.endswith("Л")), None)
        if not side:
            continue
        y = b.z + b.sz / 2 - side.z
        out.append(_op(
            part=side.name, face="внутренняя пласть", x=37.0, y=y,
            dia=0.0, depth=0.0, kind="slide_mount",
            hardware=runner.name, section=side.sec,
            note=f"направляющие {runner.name}: сверить отверстия по шаблону "
                 f"производителя; {runner.note}",
            requires_pattern=True,
        ))

    # Стабильный ключ для UI (без случайных id).
    for n, op in enumerate(out, start=1):
        op["id"] = f"op-{n}"
    return out


def summarize(operations: list[dict], runner: Runner, handle: Handle,
              hinge: Hinge) -> dict:
    def count(kind: str) -> int:
        return sum(int(o.get("qty", 1)) for o in operations
                   if o.get("kind") == kind)

    return {
        "hinge_model": hinge.name,
        "handle_model": handle.name,
        "runner_model": runner.name,
        "hinges": count("hinge_cup"),
        "hinge_plates": count("hinge_plate"),
        "handles": count("handle") // 1,
        "confirmats": count("confirmat_face"),
        "shelf_pins": count("shelf_pin"),
        "system32_holes": count("system32"),
        "slide_mounts": count("slide_mount"),
        "requires_pattern": sum(1 for o in operations
                                if o.get("requires_pattern")),
    }
