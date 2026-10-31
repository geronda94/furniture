#!/usr/bin/env python3
"""Проверка правил расстановки и присадки.

    python3 tests/layout.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from furniture_core import load_config, solve  # noqa: E402
from furniture_core.layout import (  # noqa: E402
    footprint,
    normalize_layout,
    validate_layout,
)

CFG = load_config(ROOT / "specs" / "shop-default.yaml")
ok = True


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    print(f"{'ok  ' if cond else 'FAIL'}   {name:<44} {detail}")
    ok &= bool(cond)


def inst(i: str, x: float, y: float, rot: float, w: float, d: float,
         mount: str = "floor") -> dict:
    return {
        "id": i, "name": i, "x": x, "y": y, "z": 0 if mount == "floor" else 1450,
        "rot": rot, "params": {"W": w, "D": d, "H": 720, "mount": mount},
    }


def codes(issues: list[dict]) -> set[str]:
    return {i["code"] for i in issues}


# 1. Демо-квартира должна проходить проверку
demo = json.loads((ROOT / "projects" / "demo-apartment" / "project.json").read_text())
issues = validate_layout(demo)
check("демо: ошибок расстановки нет",
      not any(i["level"] == "error" for i in issues), str(len(issues)))

# 2. Корпус на осевой линии перегородки = ошибка, нормализация прижимает
room = {
    "w": 4000, "d": 3000, "h": 2700, "wallT": 100,
    "outline": [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
    "partitions": [{"a": [2000, 0], "b": [2000, 3000], "wallT": 100}],
    "openings": [],
}
p = {"room": room, "instances": [inst("a", 2000, 1000, 0, 600, 560)]}
issues = validate_layout(p)
check("стена: корпус на осевой — ошибка", "in-wall" in codes(issues))
fixed, changes, issues2 = normalize_layout(p)
i = fixed["instances"][0]
check("стена: прижат к внутренней грани", i["x"] == 2100,
      f"x={i['x']}")
check("стена: после нормализации ошибок нет",
      not any(x["level"] == "error" for x in issues2))

# 3. Проём: корпус перед дверью — ошибка
room2 = {
    "w": 4000, "d": 3000, "h": 2700, "wallT": 100,
    "outline": [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
    "partitions": [{"a": [0, 1500], "b": [4000, 1500], "wallT": 100}],
    "openings": [{"id": "d1", "kind": "door", "wall": 4,
                  "x": 1200, "w": 900, "z0": 0, "z1": 2100}],
}
p2 = {"room": room2, "instances": [inst("b", 1300, 1500, 180, 600, 560)]}
issues2 = validate_layout(p2)
check("проём: дверь перекрыта — ошибка", "opening" in codes(issues2))
# убрать корпус от двери
p2["instances"][0]["x"] = 200
p2["instances"][0]["y"] = 940
issues3 = validate_layout(p2)
check("проём: вне двери — чисто", "opening" not in codes(issues3))

# 4. Зазор 50 мм в ряду закрывается
room3 = {
    "w": 4000, "d": 3000, "h": 2700, "wallT": 100,
    "outline": [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
    "partitions": [], "openings": [],
}
p3 = {"room": room3, "instances": [
    inst("c1", 900, 560, 180, 800, 560),
    inst("c2", 1550, 560, 180, 600, 560),
]}
issues4 = validate_layout(p3)
check("ряд: зазор 50 — предупреждение", "gap" in codes(issues4))
fixed3, _, _ = normalize_layout(p3)
a3 = footprint(fixed3["instances"][0])
b3 = footprint(fixed3["instances"][1])
check("ряд: зазор закрыт", abs((b3[0] - (a3[0] + a3[2]))) < 0.5,
      f"{a3[0] + a3[2]:.0f} → {b3[0]:.0f}")
check("ряд: корпуса вплотную", abs((b3[0] - (a3[0] + a3[2]))) < 0.5)

# 5. Ручки: навесной — снизу, напольный — сверху
def handle_y(params: dict) -> list[float]:
    r = solve({"product": "base-cabinet", "params": params}, CFG)
    return [o["y"] for o in r["operations"] if o["kind"] == "handle"]

wall_y = handle_y({"W": 800, "H": 720, "D": 320, "doors": 2,
                   "mount": "wall", "z": 1450})
floor_y = handle_y({"W": 800, "H": 720, "D": 560, "doors": 2,
                    "mount": "floor"})
check("ручки: навесной у нижней кромки", wall_y and max(wall_y) < 120,
      str(wall_y))
check("ручки: напольный у верхней кромки", floor_y and min(floor_y) > 600,
      str(floor_y))

# 6. Петли и карта присадки: у каждой двери свой op_part, чашка с одной стороны
r = solve({"product": "base-cabinet", "params": {
    "W": 800, "H": 720, "D": 560, "doors": 2, "mount": "floor",
}}, CFG)
cups = [o for o in r["operations"] if o["kind"] == "hinge_cup"]
parts = {o["part"] for o in cups}
check("петли: у каждой двери своя карта", len(parts) == 2, str(parts))
by_part: dict[str, list[float]] = {}
for o in cups:
    by_part.setdefault(o["part"], []).append(o["x"])
check("петли: чашки только с одной стороны",
      all(min(xs) < 50 or max(xs) > 300 for xs in by_part.values()),
      str({k: [min(v), max(v)] for k, v in by_part.items()}))
check("петли: нет двух сторон у одной створки",
      all(not (min(xs) < 50 and max(xs) > 300) for xs in by_part.values()))

# 7. Уникальные имена физических деталей
op_parts = [o.get("op_part") for o in r["objects"]]
check("scene3d: у всех деталей op_part", all(op_parts))
check("scene3d: op_part уникальны", len(set(op_parts)) == len(op_parts))

print()
if ok:
    print("Все проверки пройдены.")
    raise SystemExit(0)
print("Есть ошибки.")
raise SystemExit(1)
