#!/usr/bin/env python3
"""Пересобирает публичный демо-проект («Кухня — демо») строго по правилам.

Запуск:
    python3 tools/demo_public.py            # файл projects/demo/project.json
    python3 tools/demo_public.py --db       # + обновить строку `demo` в БД
    python3 tools/demo_public.py --check    # только проверить текущий файл

Планировка выверена по `docs/20`:
  - ряд 20..4370 вплотную к правой стене (зазор только угловой, 20 мм);
  - мойка не в углу: слева от неё тумба 300, окно над мойкой;
  - между окном и навесным шкафом 80 мм;
  - навесные только над рабочими секциями, над мойкой — окно,
    над варочной — вытяжка;
  - розетки над рабочими тумбами, не над мойкой/варочной;
  - пенал-холодильник в ряду напольных, выступает вперёд (исключение §3.3).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

from furniture_core.solve import solve as solve_product  # noqa: E402
from furniture_core.layout import validate_layout  # noqa: E402
from furniture_core.scene import validate_scene  # noqa: E402
from furniture_core.standards import validate_standards  # noqa: E402

OUT = ROOT / "projects" / "demo" / "project.json"
PID = "demo"
NAME = "Кухня — демо"
SHOP = "shop-ro-bucuresti"
ROOM_W, ROOM_D, ROOM_H, WALL_T = 4390.0, 3200.0, 2700.0, 100.0
PLINTH, WORKTOP = 100.0, 38.0

BASE = {
    "t": 16, "back": "dvp", "backT": 4, "roof": True,
    "reinforce": "auto", "frame": "inset", "hardware": "blum",
    "runners": "tandem-21", "mount": "floor",
    "plinthH": PLINTH, "worktopT": WORKTOP,
    "gapSide": 2, "gapBetween": 3, "gapTop": 2, "gapBottom": 2,
    "handle": "bar-128", "fastener": "auto",
}

# (имя, x правого торца, W, D, H, z, доп. параметры)
MODULES = [
    ("Тумба 300", 320, 300, 560, 720, 0, {"doors": 1, "shelves": 1}),
    ("Мойка 800", 1120, 800, 560, 720, 0, {
        "doors": 2, "shelves": 1,
        "cutouts": [{"x": 170, "y": 150, "w": 460, "h": 380}],
    }),
    ("ПММ 600", 1720, 600, 560, 720, 0, {"doors": 1, "shelves": 1}),
    ("Варочная 600", 2320, 600, 560, 720, 0, {
        "drawers": 2, "shelves": 0,
        "cutouts": [{"x": 80, "y": 120, "w": 440, "h": 320}],
    }),
    ("Тумба 800", 3120, 800, 560, 720, 0, {"doors": 2, "shelves": 1}),
    ("Тумба 600", 3720, 600, 560, 720, 0, {"doors": 1, "shelves": 1}),
    ("Пенал-холодильник 650", 4370, 650, 650, 2200, 0, {
        "doors": 2, "shelves": 4, "plinthH": 0, "worktopT": 0,
    }),
    ("Навесной 600", 1720, 600, 320, 720, 1450, {
        "doors": 2, "shelves": 2, "mount": "wall",
        "plinthH": 0, "worktopT": 0,
    }),
    ("Навесной 800", 3120, 800, 320, 720, 1450, {
        "doors": 2, "shelves": 2, "mount": "wall",
        "plinthH": 0, "worktopT": 0,
    }),
    ("Навесной 600", 3720, 600, 320, 720, 1450, {
        "doors": 2, "shelves": 2, "mount": "wall",
        "plinthH": 0, "worktopT": 0,
    }),
    ("Антресоль 600", 1720, 600, 320, 480, 2170, {
        "doors": 2, "shelves": 1, "mount": "wall",
        "plinthH": 0, "worktopT": 0,
    }),
    ("Антресоль 800", 3120, 800, 320, 480, 2170, {
        "doors": 2, "shelves": 1, "mount": "wall",
        "plinthH": 0, "worktopT": 0,
    }),
    ("Антресоль 600", 3720, 600, 320, 480, 2170, {
        "doors": 2, "shelves": 1, "mount": "wall",
        "plinthH": 0, "worktopT": 0,
    }),
]


def build() -> dict:
    instances = []
    for idx, (name, right, W, D, H, z, extra) in enumerate(MODULES, start=1):
        params = {**BASE, "W": W, "H": H, "D": D, "zone": "Кухня", **extra}
        instances.append({
            "id": f"i{idx}", "product": "base-cabinet", "name": name,
            "x": float(right), "y": float(D), "z": float(z),
            "rot": 180.0, "zLocked": True, "params": params,
        })
    doc = {
        "schema": "furniture/project@0",
        "name": NAME,
        "shop": SHOP,
        "market": "ro",
        "supplier": "generic",
        "room": {
            "w": ROOM_W, "d": ROOM_D, "h": ROOM_H, "wallT": WALL_T,
            "floor": {"enabled": True, "material": "floor", "t": 0},
            "ceiling": {"enabled": False, "material": "ceiling", "t": 0},
            "outline": [[0, 0], [ROOM_W, 0], [ROOM_W, ROOM_D], [0, ROOM_D]],
            "partitions": [],
            "openings": [
                # окно над мойкой (мойка 320..1120), 80 мм до навесного шкафа
                {"id": "o1", "kind": "window", "wall": 0, "x": 340,
                 "w": 700, "z0": 900, "z1": 2200},
                {"id": "o2", "kind": "door", "wall": 2, "x": 1800,
                 "w": 900, "z0": 0, "z1": 2100, "hinge": "left",
                 "angle": 80, "open": False},
            ],
            "wallItems": [
                # розетки над рабочими тумбами (2320..3120 и 3120..3720)
                {"id": "w1", "kind": "socket", "wall": 0, "x": 2600,
                 "z": 1150, "w": 80, "h": 80},
                {"id": "w2", "kind": "socket", "wall": 0, "x": 3400,
                 "z": 1150, "w": 80, "h": 80},
            ],
        },
        "globals": {k: v for k, v in BASE.items() if k != "mount"},
        "instances": instances,
        "props": [{
            # вытяжка над варочной (1720..2320), низ 1500
            "id": "p-hood", "type": "hood", "name": "Вытяжка",
            "x": 2020.0, "y": 280.0, "z": 1500.0, "rot": 180.0,
            "w": 600.0, "d": 500.0, "h": 600.0,
            "color": "#b9c0c5", "accent": "#7c858c", "zone": "Кухня",
        }],
        "finishes": [{
            "id": "fin-floor", "name": "Пол кухни", "kind": "floor",
            "x": 0, "y": 0, "w": ROOM_W, "d": ROOM_D,
            "material": "Плитка", "color": "#c9c2b6",
            "tileW": 600, "tileH": 600, "grout": 2, "waste": 8,
            "price_m2": 1400,
        }],
        "wallMode": "cutaway",
        "camera3d": {"alpha": -58, "beta": 24},
    }
    doc["globals"]["autoApply"] = True
    return doc


def issues(doc: dict) -> list[dict]:
    return validate_layout(doc) + validate_scene(doc) + validate_standards(doc)


def check(doc: dict) -> bool:
    found = issues(doc)
    errors = [i for i in found if i.get("level") == "error"]
    warnings = [i for i in found if i.get("level") != "error"]
    for i in found:
        print(f"  {i.get('level', 'warn'):5} {i.get('code')}: {i.get('message')}")
    for inst in doc.get("instances", []):
        try:
            solve_product(
                inst, market=doc.get("market"), shop=doc.get("shop"),
                supplier=doc.get("supplier"),
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  расчёт {inst.get('name')}: {exc}")
            errors.append({"code": "solve", "level": "error"})
    print(f"модулей: {len(doc.get('instances', []))}, "
          f"ошибок: {len(errors)}, предупреждений: {len(warnings)}")
    return not errors


def upsert_db(doc: dict) -> None:
    """Обновить публичную строку демо в БД (owner = NULL)."""
    from apps.api import storage
    storage.put_project(PID, doc, owner=None)
    print(f"БД: строка `{PID}` обновлена")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", action="store_true", help="обновить демо в БД")
    ap.add_argument("--check", action="store_true", help="только проверить файл")
    args = ap.parse_args()

    if args.check:
        doc = json.loads(OUT.read_text(encoding="utf-8"))
        return 0 if check(doc) else 1

    doc = build()
    ok = check(doc)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    print(f"записано: {OUT.relative_to(ROOT)}")
    if args.db:
        upsert_db(doc)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
