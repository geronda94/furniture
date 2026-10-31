#!/usr/bin/env python3
"""Собирает демо-кухню 2026 по текущим правилам (`docs/01`, `docs/20`).

Запуск:
    python3 tools/demo_kitchen_2026.py [--check]

Пишет `projects/demo-kitchen-2026/project.json` и (с `--check`) прогоняет
расчёт каждого модуля, валидатор расстановки и проверку коллизий сцены.
Скрипт детерминированный: одинаковый вход → одинаковый JSON.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from furniture_core import load_config, solve  # noqa: E402
from furniture_core.layout import validate_layout  # noqa: E402
from furniture_core.scene import validate_scene  # noqa: E402

OUT = ROOT / "projects" / "demo-kitchen-2026" / "project.json"
SHOP = "shop-ro-bucuresti"
ROOM_W, ROOM_D, ROOM_H, WALL_T = 4390, 3200, 2700, 100
PLINTH, WORKTOP = 100, 38

MATERIALS = {
    "corpus": {
        "name": "ЛДСП Дуб Сонома", "color": "#d8bf9b", "accent": "#b99a70",
        "pattern": "wood", "texScale": 650,
    },
    "facade": {
        "name": "МДФ Шалфей", "color": "#7d8f7b", "accent": "#63745f",
        "pattern": "solid",
    },
    "worktop": {
        "name": "Столешница Кварц", "color": "#e9e6df", "accent": "#c9c5bb",
        "pattern": "stone", "texScale": 1400,
    },
    "plinth": {
        "name": "Цоколь Антрацит", "color": "#22262a", "accent": "#14171a",
        "pattern": "solid",
    },
    "back": {
        "name": "ДВП Светлая", "color": "#efede7", "accent": "#ddd9d0",
        "pattern": "solid",
    },
    "drawer": {
        "name": "Ящик Металл", "color": "#9aa0a6", "accent": "#7b8288",
        "pattern": "metal",
    },
    "floor": {
        "name": "Ламинат Дуб", "color": "#b79a70", "accent": "#a08355",
        "pattern": "wood", "texScale": 1200,
    },
    "ceiling": {
        "name": "Потолок", "color": "#f3f1ec", "accent": "#e6e3dc",
        "pattern": "solid",
    },
    "leg": {
        "name": "Ножки", "color": "#3a3f44", "accent": "#2a2e32",
        "pattern": "metal",
    },
}


def base_params(**kw) -> dict:
    p = {
        "W": 600, "H": 720, "D": 560,
        "doors": 0, "drawers": 0, "shelves": 1, "dividers": 0,
        "frame": "inset", "hardware": "blum", "runners": "tandem-21",
        "t": 16, "back": "dvp", "backT": 4, "roof": True,
        "reinforce": "auto", "mount": "floor",
        "plinthH": PLINTH, "worktopT": WORKTOP,
        "gapSide": 2, "gapBetween": 3, "gapTop": 2, "gapBottom": 2,
        "zone": "Кухня",
    }
    p.update(kw)
    return p


def base(x: float, name: str, **kw) -> dict:
    return {
        "id": "", "product": "base-cabinet", "name": name,
        "x": float(x), "y": float(ROOM_D - 560), "z": 0.0,
        "rot": 0.0, "zLocked": True,
        "params": base_params(**kw),
    }


def wall_unit(x: float, w: float, doors: int, name: str) -> dict:
    return {
        "id": "", "product": "base-cabinet", "name": name,
        "x": float(x), "y": float(ROOM_D - 320), "z": 1450.0,
        "rot": 0.0, "zLocked": True,
        "params": base_params(
            W=w, H=720, D=320, doors=doors, shelves=2, mount="wall",
            plinthH=0, worktopT=0,
        ),
    }


def tall(x: float, name: str) -> dict:
    return {
        "id": "", "product": "base-cabinet", "name": name,
        "x": float(x), "y": float(ROOM_D - 650), "z": 0.0,
        "rot": 0.0, "zLocked": True,
        "params": base_params(
            W=650, H=2200, D=650, doors=2, shelves=4,
            plinthH=0, worktopT=0,
        ),
    }


def build() -> dict:
    # Ряд: 800 + 600 + 600 + 800 + 600 + 650 = 4050, вплотную.
    # Мойка не в углу (320 мм), справа пенал упирается в стену (4390).
    instances = [
        base(320, "Мойка 800", W=800, doors=2, shelves=1, cutouts=[
            {"x": 170, "y": 150, "w": 460, "h": 380},
        ]),
        base(1120, "ПММ 600", W=600, doors=1, shelves=1),
        base(1720, "Варочная 600", W=600, drawers=2, shelves=0),
        base(2320, "Тумба 800", W=800, doors=2, shelves=1),
        base(3120, "Тумба 600", W=600, doors=1, shelves=1),
        tall(3720, "Пенал-холодильник 650"),
        wall_unit(1120, 600, 1, "Навесной 600"),
        wall_unit(2320, 800, 2, "Навесной 800"),
        wall_unit(3120, 600, 1, "Навесной 600"),
    ]
    for i, inst in enumerate(instances, start=1):
        inst["id"] = f"i{i}"

    room = {
        "w": ROOM_W, "d": ROOM_D, "h": ROOM_H, "wallT": WALL_T,
        "outline": [[0, 0], [ROOM_W, 0], [ROOM_W, ROOM_D], [0, ROOM_D]],
        "partitions": [],
        "floor": {"enabled": True, "material": "floor", "t": 0},
        "ceiling": {"enabled": False, "material": "ceiling", "t": 0},
        "wallItems": [],
        "openings": [
            # окно над мойкой (стена 2 идёт справа налево): мир 400…1040,
            # 80 мм до навесного шкафа на 1120
            {"id": "o1", "kind": "window", "wall": 2,
             "x": 3350, "w": 640, "z0": 1050, "z1": 2100},
            # входная дверь в противоположной стене
            {"id": "o2", "kind": "door", "wall": 0,
             "x": 2600, "w": 900, "z0": 0, "z1": 2100,
             "hinge": "left", "angle": 80, "open": False},
        ],
    }

    props = [
        {"id": "p1", "type": "rug", "name": "Ковёр", "x": 2000, "y": 1580,
         "z": 0, "rot": 0, "w": 2300, "d": 1000, "h": 10,
         "color": "#8d7f70", "zone": "Кухня"},
        {"id": "p2", "type": "coffee-table", "name": "Обеденный стол",
         "x": 2000, "y": 1420, "z": 0, "rot": 0, "w": 1200, "d": 800,
         "h": 750, "color": "#6b4f3a", "accent": "#8b6a4d", "zone": "Кухня"},
        {"id": "p3", "type": "chair", "name": "Стул 1", "x": 1120, "y": 1420,
         "z": 0, "rot": 0, "w": 450, "d": 450, "h": 900,
         "color": "#6b4f3a", "accent": "#8b6a4d", "zone": "Кухня"},
        {"id": "p4", "type": "chair", "name": "Стул 2", "x": 2880, "y": 1420,
         "z": 0, "rot": 0, "w": 450, "d": 450, "h": 900,
         "color": "#6b4f3a", "accent": "#8b6a4d", "zone": "Кухня"},
        {"id": "p5", "type": "plant", "name": "Фикус", "x": 320, "y": 320,
         "z": 0, "rot": 0, "w": 420, "d": 420, "h": 1100,
         "color": "#4f7a4a", "accent": "#c9c1b2", "zone": "Кухня"},
        {"id": "p6", "type": "lamp", "name": "Торшер", "x": 1000, "y": 360,
         "z": 0, "rot": 0, "w": 360, "d": 360, "h": 1500,
         "color": "#3a3f44", "accent": "#ffe6b0", "zone": "Кухня"},
    ]

    return {
        "schema": "furniture/project@0",
        "name": "Демо — кухня 2026",
        "shop": SHOP,
        "market": "ro",
        "supplier": "generic",
        "room": room,
        "instances": instances,
        "folders": [
            {"id": "f-kitchen", "name": "Кухня",
             "area": {"x": 0, "y": 0, "w": ROOM_W, "d": ROOM_D},
             "ids": [i["id"] for i in instances]},
        ],
        "globals": {
            "t": 16, "back": "dvp", "backT": 4, "roof": True,
            "reinforce": "auto", "frame": "inset", "hardware": "blum",
            "runners": "tandem-21", "plinthH": PLINTH, "worktopT": WORKTOP,
            "gapSide": 2, "gapBetween": 3, "gapTop": 2, "gapBottom": 2,
            "autoApply": True,
        },
        "materials": MATERIALS,
        "materialVars": [],
        "finishes": [
            {"id": "fin-kitchen", "name": "Ламинат кухни", "kind": "floor",
             "x": 0, "y": 0, "w": ROOM_W, "d": ROOM_D,
             "material": "Ламинат", "color": "#b79a70",
             "tileW": 1200, "tileH": 200, "grout": 0, "waste": 8,
             "price_m2": 1400},
        ],
        "zones": ["Кухня"],
        "props": props,
        "views": [
            {"id": "v-front", "name": "Кухня — анфас", "alpha": -90,
             "beta": 18, "radius": None, "target": None},
        ],
        "log": [],
        "wallMode": "cutaway",
        "camera3d": {"alpha": -90, "beta": 20},
    }


def check(doc: dict) -> bool:
    cfg = load_config(ROOT / "specs" / "shop-default.yaml")
    ok = True
    for inst in doc["instances"]:
        product = {
            "product": inst["product"],
            "params": inst["params"],
        }
        try:
            res = solve(product, cfg)
            errs = res["validation"]["errors"]
            if errs:
                ok = False
                print(f"  ! {inst['name']}: {errs[:3]}")
            if inst["params"].get("mount") == "wall":
                # навесной не должен получить цоколь/столешницу
                if res["dims"]["outer"].get("plinth_h"):
                    ok = False
                    print(f"  ! {inst['name']}: цоколь у навесного")
        except Exception as exc:  # noqa: BLE001
            ok = False
            print(f"  ! {inst['name']}: {exc}")
    for issue in validate_layout(doc) + validate_scene(doc):
        if issue.get("level") == "error":
            ok = False
            print(f"  ! {issue.get('code')}: {issue.get('message')}")
    return ok


def main() -> int:
    doc = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    print(f"записано: {OUT.relative_to(ROOT)}")
    if "--check" in sys.argv:
        if not check(doc):
            return 1
        print("проверки: 0 ошибок")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
