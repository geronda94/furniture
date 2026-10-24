#!/usr/bin/env python3
"""Проверка геометрии: детали не должны проходить друг сквозь друга.

Golden-тесты ловят изменения, но не «правильность». Здесь — физика:
для набора конфигураций 3D-сцена проверяется на пересечения объёмов
(допуск 0.5 мм, касание гранью пересечением не считается).

    python3 tests/geometry.py
"""
from __future__ import annotations

import itertools
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from furniture_core import load_config  # noqa: E402
from furniture_core.kitchen import Section, scene3d  # noqa: E402

EPS = 0.5

CASES = {
    "1 дверь": [Section(600, 1, 0, "A")],
    "2 двери": [Section(850, 2, 0, "A")],
    "3 двери": [Section(1800, 3, 0, "A")],
    "ящики": [Section(600, 0, 3, "A")],
    "двери + ящик": [Section(900, 2, 1, "A")],
    "ряд": [
        Section(850, 2, 0, "A"),
        Section(600, 0, 3, "B"),
        Section(900, 2, 1, "C"),
    ],
    "микс 2+2": [
        Section(600, 0, 0, "M", fronts=[
            {"type": "drawers", "count": 1, "height": 200},
            {"type": "drawers", "count": 1, "height": 200},
            {"type": "doors", "count": 2, "height": 0},
        ]),
    ],
    "без крыши/задника": [
        Section(800, 2, 0, "R"),
    ],
    "навесной": [Section(600, 2, 0, "W")],
}


def overlap(a: dict, b: dict) -> tuple[bool, tuple[float, ...]]:
    dx = min(a["x"] + a["sx"], b["x"] + b["sx"]) - max(a["x"], b["x"])
    dy = min(a["y"] + a["sy"], b["y"] + b["sy"]) - max(a["y"], b["y"])
    dz = min(a["z"] + a["sz"], b["z"] + b["sz"]) - max(a["z"], b["z"])
    hit = dx > EPS and dy > EPS and dz > EPS
    return hit, (round(dx, 1), round(dy, 1), round(dz, 1))


def main() -> int:
    cfg = load_config(ROOT / "specs" / "shop-default.yaml")
    bad = 0
    variants = {
        "без крыши/задника": dict(include_roof=False, back="none",
                                  reinforce="auto"),
        "навесной": dict(mount="wall"),
        "толщина 18": dict(t=18),
    }
    for name, sections in CASES.items():
        local = load_config(ROOT / "specs" / "shop-default.yaml")
        for k, v in variants.get(name, {}).items():
            setattr(local, k, v)
        if name == "толщина 18":
            sections = [Section(800, 2, 1, "T18")]
        boxes = scene3d(sections, local)
        hits = []
        for a, b in itertools.combinations(boxes, 2):
            hit, d = overlap(a, b)
            if hit:
                hits.append((a["name"], b["name"], d))
        status = "ok  " if not hits else "FAIL"
        print(f"{status}   {name:<14} объектов {len(boxes):<3} пересечений {len(hits)}")
        for a, b, d in hits[:10]:
            print(f"         {a} × {b}  ({d[0]}×{d[1]}×{d[2]} мм)")
        bad += len(hits)
    print()
    if bad:
        print(f"НАЙДЕНЫ ПЕРЕСЕЧЕНИЯ: {bad}")
        return 1
    print("Пересечений нет.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
