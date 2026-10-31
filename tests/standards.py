#!/usr/bin/env python3
"""Проверки эргономики и безопасности (ГОСТ/EN) — tools/furniture_core/standards.py.

    python3 tests/standards.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from furniture_core.standards import validate_standards  # noqa: E402

ROOM = {"w": 4000, "d": 3000, "h": 2700, "wallT": 100,
        "outline": [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
        "partitions": [], "openings": [], "wallItems": []}
BASE = {
    "W": 800, "H": 720, "D": 560, "doors": 2, "drawers": 0, "shelves": 1,
    "t": 16, "mount": "floor", "plinthH": 100, "worktopT": 38,
    "gapSide": 2, "gapBetween": 3,
}


def inst(iid: str, **kw) -> dict:
    params = {**BASE, **kw.pop("params", {})}
    return {"id": iid, "product": "base-cabinet", "name": iid,
            "x": kw.pop("x", 0), "y": kw.pop("y", 0), "z": kw.pop("z", 0),
            "rot": 0, "params": params}


def project(instances=(), props=()) -> dict:
    return {"room": ROOM, "instances": list(instances), "props": list(props)}


def codes(doc: dict, level: str | None = None) -> list[str]:
    return [i["code"] for i in validate_standards(doc)
            if level is None or i["level"] == level]


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"{'ok  ' if cond else 'FAIL'}   {name:<46} {detail}")
    return cond


def main() -> int:
    ok = True

    good = inst("good", y=2440)
    ok &= check("кухня 858 мм — без замечаний",
                codes(project([good])) == [])

    low = inst("low", y=2440, params={"H": 600})
    ok &= check("низкая столешница — ошибка",
                "std-worktop-height" in codes(project([low]), "error"))

    plinth = inst("plinth", y=2440, params={"plinthH": 50})
    ok &= check("цоколь 50 мм — ошибка",
                "std-plinth" in codes(project([plinth]), "error"))

    wall_low = inst("wall", y=2680, z=900,
                    params={"mount": "wall", "plinthH": 0, "worktopT": 0})
    ok &= check("навесной на 900 мм — ошибка",
                "std-wall-height" in codes(project([wall_low]), "error"))

    wall_ok = inst("wall2", y=2680, z=1450,
                   params={"mount": "wall", "plinthH": 0, "worktopT": 0})
    ok &= check("навесной 1450 мм — норма",
                "std-wall-height" not in codes(project([wall_ok])))

    wide_door = inst("door", y=2440, params={"W": 900, "doors": 1})
    ok &= check("створка > 600 мм — ошибка",
                "std-door-width" in codes(project([wide_door]), "error"))

    drawer = inst("drawer", y=2440, params={"W": 1000, "doors": 0,
                                            "drawers": 3, "shelves": 0})
    ok &= check("фасад ящика > 900 мм — ошибка",
                "std-drawer-width" in codes(project([drawer]), "error"))

    shelf = inst("shelf", y=2440, params={"W": 1200, "doors": 2})
    ok &= check("полка 1200 мм — ошибка",
                "std-shelf-span" in codes(project([shelf]), "error"))

    tall = inst("tall", x=1200, y=1000,
                params={"H": 2400, "plinthH": 0, "worktopT": 0})
    tall_codes = codes(project([tall]), "warning")
    ok &= check("высокий шкаф вдали от стены — крепление",
                "std-tip-over" in tall_codes)

    shelf_ok = inst("shelf2", y=2440, params={"W": 1700, "dividers": 1})
    ok &= check("полка 1700 с divide — норма",
                "std-shelf-span" not in codes(project([shelf_ok])))

    bed_bad = {"id": "b1", "type": "bed", "name": "Кровать",
               "x": 1500, "y": 1500, "w": 1550, "d": 2200, "h": 900}
    ok &= check("кровать 1550×2200 — предупреждение",
                "std-bed-size" in codes(project([], [bed_bad]), "warning"))

    sofa_bad = {"id": "s1", "type": "sofa", "name": "Диван",
                "x": 1000, "y": 1000, "w": 900, "d": 700, "h": 800}
    ok &= check("узкий диван — предупреждение",
                "std-seat-depth" in codes(project([], [sofa_bad]), "warning"))

    ok &= check("пустой проект — без замечаний", codes(project()) == [])

    print("\nВсе проверки пройдены." if ok else "\nЕсть ошибки.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
