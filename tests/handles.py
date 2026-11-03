#!/usr/bin/env python3
"""Эргономика ручек: высокая створка — вертикальная ручка по центру ~1000 мм.

    python3 tests/handles.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from furniture_core import load_config, solve  # noqa: E402

CFG = load_config(ROOT / "specs" / "shop-default.yaml")


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"{'ok  ' if cond else 'FAIL'}   {name:<40} {detail}")
    return cond


def handles(r: dict) -> list[dict]:
    return [o for o in r.get("operations", []) if o.get("kind") == "handle"]


def solve_door(h: float, **params) -> list[dict]:
    p = {"W": 600, "H": h, "D": 560, "doors": 1, "shelves": 0,
         "worktopT": 0, "plinthH": 0, **params}
    return handles(solve({"product": "base-cabinet", "params": p}, CFG))


def span_y(ops: list[dict]) -> float:
    ys = [float(o["y"]) for o in ops]
    return max(ys) - min(ys)


def span_x(ops: list[dict]) -> float:
    xs = [float(o["x"]) for o in ops]
    return max(xs) - min(xs)


def main() -> int:
    ok = True

    tall = solve_door(2000)
    ok &= check("высокая дверь: две точки ручки", len(tall) == 2, str(len(tall)))
    if len(tall) == 2:
        ok &= check("высокая дверь: ручка вертикальная",
                    span_y(tall) == 128 and span_x(tall) == 0,
                    f"dx={span_x(tall)} dy={span_y(tall)}")
        mid = sum(float(o["y"]) for o in tall) / 2
        ok &= check("высокая дверь: центр на 1000 мм от низа",
                    abs(mid - 1000) < 0.5, f"{mid:.1f}")
        ok &= check("высокая дверь: подпись вертикальная",
                    all("вертикальная" in o.get("note", "") for o in tall))

    short = solve_door(720)
    ok &= check("короткая дверь: две точки ручки", len(short) == 2)
    if len(short) == 2:
        ok &= check("короткая дверь: ручка горизонтальная",
                    span_x(short) == 128 and span_y(short) == 0,
                    f"dx={span_x(short)} dy={span_y(short)}")
        ok &= check("короткая дверь: ручка у верхней кромки",
                    min(float(o["y"]) for o in short) > 600,
                    f"y={short[0]['y']}")

    wall = solve_door(720, mount="wall")
    ok &= check("навесной: ручка у нижней кромки",
                len(wall) == 2 and max(float(o["y"]) for o in wall) < 100,
                f"y={[o['y'] for o in wall]}")

    wall_override = solve_door(720, mount="wall", handleHeight=200)
    ok &= check("handleHeight работает и для навесного",
                len(wall_override) == 2
                and abs(float(wall_override[0]["y"]) - 200) < 0.5,
                f"y={[o['y'] for o in wall_override]}")

    override = solve_door(2000, handleHeight=1200)
    if len(override) == 2:
        mid = sum(float(o["y"]) for o in override) / 2
        ok &= check("handleHeight задаёт центр высокой ручки",
                    abs(mid - 1200) < 0.5, f"{mid:.1f}")
    else:
        ok &= check("handleHeight задаёт центр высокой ручки", False)

    knob = solve_door(2000, handle="knob-30")
    ok &= check("кнопка на высокой двери: одна точка",
                len(knob) == 1, str(len(knob)))
    if knob:
        ok &= check("кнопка на высокой двери: на 1000 мм",
                    abs(float(knob[0]["y"]) - 1000) < 0.5,
                    f"y={knob[0]['y']}")

    profile = solve_door(2000, handle="profile-04")
    ok &= check("профиль-ручка: без сверловки", len(profile) == 0,
                str(len(profile)))

    print()
    print("Все проверки пройдены." if ok else "Есть ошибки.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
