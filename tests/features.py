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


def qty_of(bom: list[dict], name: str) -> int:
    return sum(int(b.get("qty", 0)) for b in bom if b.get("name") == name)


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
    ok &= check("микс: 2 фасада ящиков",
                qty_of(r["bom"], "Фасад ящик (Модуль)") == 2,
                str(qty_of(r["bom"], "Фасад ящик (Модуль)")))
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
                qty_of(r["bom"], "Ящик передняя стенка") == 3)
    ok &= check("ящик: размеры короба",
                all(d["inner_w"] > 0 and d["panel_w"] > 0
                    for d in r["drawers"]))
    ok &= check("ящик: борта выше на 10 мм",
                all(d["side_extra"] == 10 and d["side_h"] > d["box_h"]
                    for d in r["drawers"]))
    ok &= check("ящик: крепление направляющих снизу",
                any("направляющие" in h.get("note", "") for h in r["drilling"]))
    ok &= check("ящик: без ошибок", not r["validation"]["errors"])

    # 8. Постформинг: столешница без кромки 2 мм
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2,
    }}, CFG)
    top = next((b for b in r["bom"] if b["name"] == "Столешница"), None)
    ok &= check("столешница: постформинг без кромки",
                top is not None and top["edge"].count("2") == 0,
                top["edge"] if top else "нет")

    # 9. Одинаковые детали сводятся в позицию с количеством
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "shelves": 2,
    }}, CFG)
    shelf = next((b for b in r["bom"] if b["name"] == "Полка"), None)
    ok &= check("одинаковые детали: количество",
                shelf is not None and shelf["qty"] >= 2,
                str(shelf["qty"]) if shelf else "нет")

    # 10. Зазоры фасадов из параметров изделия
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2,
        "gapSide": 0, "gapBetween": 0,
    }}, CFG)
    fasad = next((b for b in r["bom"] if b["name"].startswith("Фасад дверь")), None)
    ok &= check("зазоры: фасад во всю ширину",
                fasad is not None and abs(fasad["w"] - 400) < 0.1,
                str(fasad["w"]) if fasad else "нет")

    # 11. Петли: отступ по бренду из каталога
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "hardware": "hettich",
    }}, CFG)
    note = " ".join(str(h.get("note", "")) for h in r["drilling"])
    ok &= check("петли Hettich: отступ 22 мм",
                "Intermat" in note and "22 мм" in note, note[:60])

    # 12. Ручки из каталога
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "handle": "knob-30",
    }}, CFG)
    handle_line = next((x for x in r["cost"]["lines"]
                        if x["key"] == "handles"), None)
    ok &= check("ручки: цена по прайсу рынка",
                handle_line is not None and handle_line["unit_price"] == 9,
                str(handle_line["unit_price"]) if handle_line else "нет")

    # 13. Толщина 18 мм
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


    # 14. Крепёж корпуса из каталога: минификс
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "fastener": "minifix",
    }}, CFG)
    faces = [o for o in r["operations"] if o["kind"] == "fastener_face"]
    ok &= check("крепёж: минификс Ø15",
                bool(faces) and all(o["dia"] == 15 for o in faces)
                and r["hardware_plan"]["fastener_id"] == "minifix",
                str(sorted({o["dia"] for o in faces})))

    # 15. Опора полок: фиксируемый полкодержатель (не System 32)
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "shelves": 2,
        "shelfSupport": "lock-pin", "system32": False,
    }}, CFG)
    pins = [o for o in r["operations"] if o["kind"] == "shelf_pin"]
    ok &= check("полки: свой полкодержатель",
                bool(pins) and
                r["hardware_plan"]["shelf_support_id"] == "lock-pin" and
                not r["hardware_plan"]["system32_holes"],
                str(len(pins)))

    # 16. Газовый патрон: 2 отверстия и честный «по шаблону»
    r = solve({"product": "base-cabinet", "params": {
        "W": 600, "H": 720, "D": 560, "doors": 1, "gasStrut": "blum-20n",
    }}, CFG)
    gas = [o for o in r["operations"] if o["kind"] == "gas_strut"]
    ok &= check("газовый патрон: 2 отверстия",
                len(gas) == 2 and r["hardware_plan"]["gas_struts"] == 1,
                str(len(gas)))
    ok &= check("газовый патрон: требует шаблон",
                all(o["requires_pattern"] for o in gas))

    # 17. Кромка: тип, цвет и ПЕРЕД по каждой стороне
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2,
    }}, CFG)
    doors = [e for e in r["edge_plan"] if e["part"].startswith("Фасад дверь")]
    sides = doors[0]["sides"] if doors else {}
    ok &= check("кромка: 4 стороны фасада", len(sides) == 4, str(len(sides)))
    ok &= check("кромка: тип ПВХ 2 мм",
                all(v["type"] == "pvc_2" and v["color"] for v in sides.values()))
    side_rows = [e for e in r["edge_plan"]
                 if e["part"] == "Боковина лев."]
    ok &= check("кромка: ПЕРЕД отмечен",
                bool(side_rows) and
                any(v["front"] for v in side_rows[0]["sides"].values()),
                str(side_rows[0]["sides"]) if side_rows else "нет")
    ok &= check("кромка: метры по типам",
                bool(r.get("edges_by_type")) and
                any(m > 0 for m in r["edges_by_type"].values()),
                str(r.get("edges_by_type")))

    # 18. Цены: рынок, цех, поставщик
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2,
    }}, CFG)
    ok &= check("цены: рынок RO и RON",
                r["cost"]["market"] == "ro" and r["cost"]["currency"] == "RON",
                f'{r["cost"]["market"]}/{r["cost"]["currency"]}')
    ok &= check("цены: НДС 21%",
                r["cost"]["vat_percent"] == 21 and r["cost"]["vat"] > 0,
                str(r["cost"].get("vat")))
    r_eu = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2,
    }}, CFG, market="eu")
    ok &= check("цены: рынок EU и EUR",
                r_eu["cost"]["market"] == "eu" and
                r_eu["cost"]["currency"] == "EUR",
                r_eu["cost"]["currency"])
    r_blum = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2,
    }}, CFG, supplier="blum")
    hg_a = next(x["unit_price"] for x in r["cost"]["lines"]
                if x["key"] == "hinges")
    hg_b = next(x["unit_price"] for x in r_blum["cost"]["lines"]
                if x["key"] == "hinges")
    ok &= check("цены: поставщик влияет", hg_b > hg_a,
                f"{hg_a} → {hg_b}")

    # 19. Направляющие с типовым шаблоном: точные отверстия
    r = solve({"product": "base-cabinet", "params": {
        "W": 600, "H": 720, "D": 560, "doors": 0, "drawers": 2,
        "shelves": 0, "runners": "ball-13",
    }}, CFG)
    slides = [o for o in r["operations"]
              if o["kind"] in ("slide_mount", "slide_box")]
    ok &= check("направляющие: шаблон без флага",
                bool(slides) and not any(o["requires_pattern"] for o in slides)
                and r["hardware_plan"]["slide_box_holes"] >= 2,
                str(len(slides)))

    # 20. Ручка двери — у края открывания, ручка ящика — по центру
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "drawers": 1,
    }}, CFG)
    door_handles = [o for o in r["operations"]
                    if o["kind"] == "handle" and o["part_kind"] == "door"
                    and o["section"] == 1]
    drawer_handles = [o for o in r["operations"]
                      if o["kind"] == "handle" and
                      o["part_kind"] == "drawer_front"]
    fw = 394.0
    ok &= check("ручки: дверь у края открывания",
                bool(door_handles) and
                max(o["x"] for o in door_handles) > fw / 2,
                str([o["x"] for o in door_handles]))
    ok &= check("ручки: ящик по центру",
                bool(drawer_handles) and
                abs(sum(o["x"] for o in drawer_handles) /
                    len(drawer_handles) - 394.0) < 20,
                str([o["x"] for o in drawer_handles]))

    # 21. Позиции полок и ящиков относительно низа модуля
    r = solve({"product": "base-cabinet", "params": {
        "W": 600, "H": 720, "D": 560, "drawers": 2, "shelves": 2,
    }}, CFG)
    ok &= check("ящик: центр направляющей от пола",
                bool(r["drawers"]) and
                r["drawers"][0]["runner_center_from_floor"] > 0,
                str(r["drawers"][0].get("runner_center_from_floor")))
    ok &= check("полки: цепочка высот",
                len(r["shelves"]) == 2 and
                r["shelves"][1]["from_shelf_below"] is not None,
                str(r["shelves"]))


    # 22. Кромка — по видимости торцов, а не только у открытой секции
    def edge_of(bom: list[dict], name: str) -> str:
        row = next((b for b in bom if b["name"] == name), None)
        return row["edge"] if row else ""

    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "shelves": 2,
    }}, CFG)
    ok &= check("кромка: полка спереди 2 мм",
                "ПЕРЕД2" in edge_of(r["bom"], "Полка"),
                edge_of(r["bom"], "Полка"))
    ok &= check("кромка: боковина спереди 2 мм",
                "ПЕРЕД2" in edge_of(r["bom"], "Боковина лев."),
                edge_of(r["bom"], "Боковина лев."))
    ok &= check("кромка: вкладная — верх/низ боковины 2 мм",
                "верх2" in edge_of(r["bom"], "Боковина лев.") and
                "низ2" in edge_of(r["bom"], "Боковина лев."),
                edge_of(r["bom"], "Боковина лев."))
    ok &= check("кромка: крыша спереди 2 мм",
                "ПЕРЕД2" in edge_of(r["bom"], "Крыша"),
                edge_of(r["bom"], "Крыша"))
    ok &= check("кромка: бока крыши закрыты боковинами",
                "лев-" in edge_of(r["bom"], "Крыша") and
                "прав-" in edge_of(r["bom"], "Крыша"),
                edge_of(r["bom"], "Крыша"))

    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "shelves": 2,
        "roof": False,
    }}, CFG)
    ok &= check("кромка: без крыши верх боковины 2 мм",
                "верх2" in edge_of(r["bom"], "Боковина лев."),
                edge_of(r["bom"], "Боковина лев."))

    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "shelves": 2,
        "back": "none",
    }}, CFG)
    ok &= check("кромка: без задника задний торец 0.4",
                "лев0.4" in edge_of(r["bom"], "Боковина лев."),
                edge_of(r["bom"], "Боковина лев."))
    ok &= check("кромка: без задника зад полки 0.4",
                "верх0.4" in edge_of(r["bom"], "Полка"),
                edge_of(r["bom"], "Полка"))

    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "frame": "overlay",
    }}, CFG)
    ok &= check("кромка: накладная — бока крыши 2 мм",
                "лев2" in edge_of(r["bom"], "Крыша") and
                "прав2" in edge_of(r["bom"], "Крыша"),
                edge_of(r["bom"], "Крыша"))
    ok &= check("кромка: накладная — верх/низ боковины закрыты",
                "верх-" in edge_of(r["bom"], "Боковина лев.") and
                "низ-" in edge_of(r["bom"], "Боковина лев."),
                edge_of(r["bom"], "Боковина лев."))
    ok &= check("кромка: перегородка спереди 2 мм",
                (lambda e: "ПЕРЕД2" in e)(edge_of(
                    solve({"product": "base-cabinet", "params": {
                        "W": 800, "H": 720, "D": 560, "dividers": 1,
                    }}, CFG)["bom"], "Перегородка")),
                "перегородка")


    # 23. System 32 — техническая сетка: в карту попадают только занятые ячейки
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "shelves": 2,
    }}, CFG)
    ok &= check("System 32: сетка не выдаётся",
                not any(o["kind"] == "system32" for o in r["operations"]),
                str(len(r["operations"])))
    ok &= check("System 32: только занятые полкодержатели",
                r["hardware_plan"]["shelf_pins"] == 8 and
                r["hardware_plan"]["system32_holes"] == 0,
                f'{r["hardware_plan"]["shelf_pins"]}/'
                f'{r["hardware_plan"]["system32_holes"]}')


    # 24. Ящик: кромка только на открытых торцах
    r = solve({"product": "base-cabinet", "params": {
        "W": 600, "H": 720, "D": 560, "doors": 0, "drawers": 2,
        "shelves": 0,
    }}, CFG)
    box_side = edge_of(r["bom"], "Ящик боковина")
    ok &= check("ящик: верхний торец 0.4", "верх0.4" in box_side, box_side)
    ok &= check("ящик: низ/бока не кромкуются",
                "низ-" in box_side and "лев-" in box_side and
                "прав-" in box_side, box_side)


    # 25. Кромка: переопределения типов и отказ
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "doors": 2, "shelves": 2,
        "edges": {
            "visible": "abs_2",
            "byPart": {"Полка": {"front": "none"}},
        },
    }}, CFG)
    shelf = next(b for b in r["bom"] if b["name"] == "Полка")
    ok &= check("кромка: отказ по детали",
                "ПЕРЕД-" in shelf["edge"], shelf["edge"])
    roof_row = next(e for e in r["edge_plan"] if e["part"] == "Крыша")
    ok &= check("кромка: тип ABS по политике",
                all(v["type"] == "abs_2" for v in roof_row["sides"].values()),
                str([v["type"] for v in roof_row["sides"].values()]))

    # 26. Крепёж: скрытый и по классам соединений
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "dividers": 1, "shelves": 0,
        "hiddenFasteners": True, "fastener": "auto",
    }}, CFG)
    ok &= check("крепёж: скрытый — минификс",
                all(j["fastener_id"] == "minifix"
                    for j in r["hardware_plan"]["joints"]))
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "dividers": 1, "shelves": 0,
        "fastener": "auto",
        "connectionOverrides": {"carcass": "minifix", "divider": "confirmat"},
    }}, CFG)
    by_cls = {j["class"]: j["fastener_id"] for j in r["hardware_plan"]["joints"]}
    ok &= check("крепёж: классы соединений",
                by_cls.get("carcass") == "minifix" and
                by_cls.get("divider") == "confirmat",
                str(by_cls))

    # 27. Саморезы фасадов ящиков
    r = solve({"product": "base-cabinet", "params": {
        "W": 600, "H": 720, "D": 560, "doors": 0, "drawers": 2,
        "shelves": 0,
    }}, CFG)
    ok &= check("ящики: 4 самореза на фасад",
                r["hardware_plan"]["screws"] == 8 and
                any(o["kind"] == "screw_front" for o in r["operations"]),
                str(r["hardware_plan"]["screws"]))


    # 28. Разметка опор/колёс на дне
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "legMount": "leg-plate-60",
    }}, CFG)
    legs_ops = [o for o in r["operations"] if o["kind"] == "leg_mount"]
    ok &= check("опоры: 4×4 отверстия в дне",
                r["hardware_plan"]["leg_holes"] == 16 and
                all(o["face"].startswith("наружная") for o in legs_ops),
                str(r["hardware_plan"]["leg_holes"]))
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "legMount": "leg-thread-m8",
    }}, CFG)
    ok &= check("опоры: врезная гайка — 4 отверстия",
                r["hardware_plan"]["leg_holes"] == 4,
                str(r["hardware_plan"]["leg_holes"]))
    r = solve({"product": "base-cabinet", "params": {
        "W": 800, "H": 720, "D": 560, "legMount": "leg-none",
    }}, CFG)
    ok &= check("опоры: без разметки",
                r["hardware_plan"]["leg_holes"] == 0)

    print()
    print("Все проверки пройдены." if ok else "Есть ошибки.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
