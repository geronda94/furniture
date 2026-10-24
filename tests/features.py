#!/usr/bin/env python3
"""Проверка новых возможностей движка: компоновка фасадов, задник, царги,
навесные модули, вырезы, толщина плиты.

    python3 tests/features.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from furniture_core import load_config, solve  # noqa: E402

CFG = load_config(ROOT / "specs" / "shop-default.yaml")


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"{'ok  ' if cond else 'FAIL'}   {name:<34} {detail}")
    return cond


def main() -> int:
    ok = True

    # 1. Микс: 2 ряда ящиков + двери в одном корпусе
    r = solve({"product": "base-cabinet", "params": {
        "W": 600, "H": 720, "D": 560,
        "fronts": [
            {"type": "drawers", "count": 1, "height": 200},
            {"type": "drawers", "count": 1, "height": 200},
            {"type": "doors", "count": 2, "height": 0},
        ],
    }}, CFG)
    names = [b["name"] for b in r["bom"]]
    ok &= check("микс: 2 фасада ящиков", names.count("Фасад ящик (Модуль)") == 2,
                str(names.count("Фасад ящик (Модуль)")))
    ok &= check("микс: фасад дверей", names.count("Фасад дверь (Модуль)") == 1)
    ok &= check("микс: без ошибок", not r["validation"]["errors"],
                str(r["validation"]["errors"]))

    # 2. Без крыши и задника — царги, нет крыши/задника
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2,
        "roof": False, "back": "none", "reinforce": "auto",
    }}, CFG)
    names = [b["name"] for b in r["bom"]]
    ok &= check("без крыши: нет крыши", "Крыша" not in names)
    ok &= check("без задника: нет задней", "Задняя стенка" not in names)
    ok &= check("царги добавлены", any(n.startswith("Царга") for n in names))
    ok &= check("без крыши: без ошибок", not r["validation"]["errors"])

    # 3. Навесной модуль
    r = solve({"product": "base-cabinet", "params": {
        "W": 600, "H": 720, "D": 300, "doors": 2, "mount": "wall",
    }}, CFG)
    names = [b["name"] for b in r["bom"]]
    ok &= check("навесной: нет цоколя", "Цоколь" not in names)
    ok &= check("навесной: нет столешницы", "Столешница" not in names)
    ok &= check("навесной: объекты без ножек",
                not any(o["name"] == "Ножка" for o in r["objects"]))
    ok &= check("навесной: без ошибок", not r["validation"]["errors"])

    # 4. Вырез в столешнице
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2,
        "cutouts": [{"x": 250, "y": 150, "w": 400, "h": 350}],
    }}, CFG)
    tops = [o for o in r["objects"] if o["name"] == "Столешница"]
    ok &= check("вырез: столешница разбита", len(tops) >= 4, str(len(tops)))
    ok &= check("вырез: в присадке",
                any("вырез" in h.get("note", "") for h in r["drilling"]))
    ok &= check("вырез: без ошибок", not r["validation"]["errors"])

    # 5. Двери не создают перегородку автоматически
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "shelves": 2,
    }}, CFG)
    names = [b["name"] for b in r["bom"]]
    ok &= check("2 двери: без перегородки", "Перегородка" not in names)
    ok &= check("2 двери: полки по отсекам", "Полка" in names)

    # 6. Перегородки — только явные
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "dividers": 1,
    }}, CFG)
    names = [b["name"] for b in r["bom"]]
    ok &= check("явная перегородка", "Перегородка" in names)
    ok &= check("явная перегородка: кол-во", r["bom"][
        names.index("Перегородка")]["qty"] == 1 if "Перегородка" in names else False)

    # 7. Ящик: передняя стенка короба под фасад
    r = solve({"product": "base-cabinet", "params": {
        "W": 600, "H": 720, "D": 560, "drawers": 3, "doors": 0,
        "shelves": 0, "runners": "tandem-21",
    }}, CFG)
    names = [b["name"] for b in r["bom"]]
    ok &= check("ящик: передняя стенка", "Ящик передняя стенка" in names)
    ok &= check("ящик: передняя стенка x3",
                names.count("Ящик передняя стенка") == 3)
    ok &= check("ящик: размеры короба",
                all(d["inner_w"] > 0 and d["panel_w"] > 0
                    for d in r["drawers"]))
    ok &= check("ящик: борта выше на 10 мм",
                all(d["side_extra"] == 10 and d["side_h"] > d["box_h"]
                    for d in r["drawers"]))
    ok &= check("ящик: крепление направляющих снизу",
                any("направляющие" in h.get("note", "") for h in r["drilling"]))
    ok &= check("ящик: без ошибок", not r["validation"]["errors"])

    # 8. Толщина 18 мм
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "t": 18,
        "back": "same",
    }}, CFG)
    ok &= check("толщина 18: принята", r["dims"]["t"] == 18,
                str(r["dims"]["t"]))
    ok &= check("толщина 18: задник ЛДСП",
                any(b["name"] == "Задняя стенка" and b["material"] == "ЛДСП"
                    for b in r["bom"]))
    ok &= check("толщина 18: без ошибок", not r["validation"]["errors"])

    print()
    print("Все проверки пройдены." if ok else "Есть ошибки.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
