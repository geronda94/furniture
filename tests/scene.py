"""Проверки объёмной валидации: мебель, декор, двери, цоколь, зазоры."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from furniture_core.layout import validate_layout  # noqa: E402
from furniture_core.scene import normalize_scene, validate_scene  # noqa: E402

ok = True


def check(name: str, cond: bool, detail: object = "") -> None:
    global ok
    print(("ok     " if cond else "FAIL   ") + name)
    if not cond:
        ok = False
        print("       ", detail)


def room(w=4000, d=4000, h=2700, openings=None):
    return {
        "w": w, "d": d, "h": h, "wallT": 100,
        "outline": [[0, 0], [w, 0], [w, d], [0, d]],
        "partitions": [], "openings": openings or [],
    }


def inst(iid="i1", name="Модуль", x=0.0, y=3440.0, rot=0.0,
         W=600.0, H=720.0, D=560.0, **params):
    p = {
        "W": W, "H": H, "D": D, "doors": 1, "drawers": 0, "shelves": 1,
        "mount": "floor", "plinthH": 100, "worktopT": 0,
        "gapSide": 2, "gapBetween": 3, "gapTop": 2, "gapBottom": 2,
    }
    p.update(params)
    return {
        "id": iid, "name": name, "product": "base-cabinet",
        "x": x, "y": y, "z": 0, "rot": rot, "params": p,
    }


def prop(pid="p1", name="Декор", kind="plant", x=2000.0, y=2000.0,
         w=400.0, d=400.0, h=800.0, z=0.0, rot=0.0):
    return {
        "id": pid, "name": name, "type": kind, "x": x, "y": y, "z": z,
        "w": w, "d": d, "h": h, "rot": rot, "color": "#888888",
    }


def project(instances=None, props=None, openings=None, h=2700):
    return {
        "schema": "furniture/project@0",
        "name": "test",
        "room": room(h=h, openings=openings),
        "instances": instances or [],
        "props": props or [],
        "materials": {}, "materialVars": [],
    }


def codes(issues):
    return {i["code"] for i in issues}


def errors(issues):
    return [i for i in issues if i.get("level") == "error"]


# --- 1. цоколь выше корпуса ------------------------------------------------
doc = project([inst(H=300, plinthH=500)])
issues = validate_layout(doc) + validate_scene(doc)
check("цоколь выше корпуса — ошибка", "plinth" in codes(issues), issues)

# --- 2. цоколь/пол: отрицательный низ -------------------------------------
doc = project([inst()])
doc["instances"][0]["z"] = -50
issues = validate_layout(doc) + validate_scene(doc)
check("объект ниже пола — ошибка", "below-floor" in codes(issues), issues)

# --- 3. столешница/корпус в стене -----------------------------------------
doc = project([inst(y=10, worktopT=38)])
issues = validate_scene(doc)
check("выступ столешницы в стену — ошибка", "in-wall" in codes(issues), issues)

# --- 4. декор в стене ------------------------------------------------------
doc = project(props=[prop(x=50, y=50)])
issues = validate_scene(doc)
check("декор в стене — ошибка", "prop-in-wall" in codes(issues), issues)

# --- 5. декор пересекает мебель -------------------------------------------
doc = project([inst(x=0, y=0)], [prop(x=300, y=300)])
issues = validate_scene(doc)
check("декор пересекает мебель — ошибка", "prop-overlap" in codes(issues), issues)

# --- 6. декор пересекает декор --------------------------------------------
doc = project(props=[prop("p1", x=1000, y=1000), prop("p2", x=1100, y=1000)])
issues = validate_scene(doc)
check("декор пересекает декор — ошибка", "prop-prop" in codes(issues), issues)

# --- 7. разрыв в непрерывном ряду -----------------------------------------
doc = project([
    inst("i1", x=0, y=3440, zone="Кухня-гостиная"),
    inst("i2", x=700, y=3440, zone="Кухня-гостиная"),
])
issues = validate_layout(doc)
check("разрыв 100 мм в непрерывном ряду — ошибка",
      "gap" in codes(errors(issues)), issues)

# --- 8. дверь фасада задевает декор ---------------------------------------
doc = project([inst("i1", x=0, y=1000, doors=1)], [prop(x=300, y=600)])
issues = validate_scene(doc)
check("дверь фасада задевает декор — ошибка",
      "door-swing-prop" in codes(issues), issues)

# --- 8.1. выдвинутый ящик задевает декор ---------------------------------
doc = project([inst("i1", x=0, y=1000, doors=0, drawers=1)],
              [prop(x=300, y=600)])
issues = validate_scene(doc)
check("выдвинутый ящик задевает декор — ошибка",
      "drawer-prop" in codes(issues), issues)

# --- 8.2. сектор двери не трогает угол вне дуги --------------------------
doc = project([inst("i1", x=0, y=1000, doors=1)],
              [prop(x=600, y=500, w=100, d=100, h=600)])
issues = validate_scene(doc)
check("декор вне дуги двери не считается столкновением",
      "door-swing-prop" not in codes(issues), issues)

# --- 8.3. сектор двери комнаты уважает петлю -----------------------------
doc = project(
    props=[prop("p1", kind="plant", x=2200, y=850, w=100, d=100, h=800)],
    openings=[{"id": "d1", "kind": "door", "wall": 0, "x": 1400,
               "w": 900, "z0": 0, "z1": 2100, "hinge": "left"}],
)
issues = validate_scene(doc)
check("декор вне дуги комнатной двери не считается столкновением",
      "prop-opening" not in codes(issues), issues)

# --- 8.35. компоновка fronts: только ящики — нет створок ----------------
doc = project([inst("i1", x=0, y=1000, doors=1,
                    fronts=[{"type": "drawers", "count": 3}])],
              [prop(x=300, y=600, w=100, d=100, h=600)])
issues = validate_scene(doc)
check("fronts из ящиков не создаёт зону двери",
      "door-swing-prop" not in codes(issues), issues)

# --- 8.36. дверь ниже блока ящиков: z-диапазон учитывается ---------------
doc = project([inst("i1", x=0, y=1000,
                    fronts=[{"type": "drawers", "count": 1, "height": 200},
                            {"type": "doors", "count": 1}])],
              [prop("high", x=300, y=600, w=100, d=100, h=100, z=1000)])
issues = validate_scene(doc)
check("декор выше створки не считается ударом двери",
      "door-swing-prop" not in codes(issues), issues)

# --- 8.4. ход ящика зависит от глубины корпуса ---------------------------
# Мелкий модуль D=300: выкат ~260 мм, предмет в 300 мм не мешает.
doc = project([inst("i1", x=0, y=1000, doors=0, drawers=1, D=300)],
              [prop(x=300, y=650, w=100, d=100, h=600)])
issues = validate_scene(doc)
check("мелкий ящик не бьёт предмет в 300 мм",
      "drawer-prop" not in codes(issues), issues)
# Глубокий D=560: выкат ~520 мм, тот же предмет уже мешает.
doc = project([inst("i1", x=0, y=1000, doors=0, drawers=1, D=560)],
              [prop(x=300, y=650, w=100, d=100, h=600)])
issues = validate_scene(doc)
check("глубокий ящик бьёт предмет в 300 мм",
      "drawer-prop" in codes(issues), issues)

# --- 9. дверь фасада задевает другой модуль -------------------------------
doc = project([
    inst("i1", x=0, y=1000, doors=1),
    inst("i2", x=0, y=400, doors=0),
])
issues = validate_scene(doc)
check("дверь фасада задевает мебель — ошибка",
      "door-swing-instance" in codes(issues), issues)

# --- 10. дверь фасада задевает дверной проём ------------------------------
doc = project(
    [inst("i1", x=1500, y=500, doors=1)],
    openings=[{"id": "d1", "kind": "door", "wall": 0, "x": 1400,
               "w": 900, "z0": 0, "z1": 2100}],
)
issues = validate_scene(doc)
check("дверь фасада задевает дверной проём — ошибка",
      "door-swing-opening" in codes(issues), issues)

# --- 10.1. авторазведение декора -----------------------------------------
doc = project([inst("i1", x=0, y=3440)], [prop(x=300, y=3440)])
fixed, changes, issues = normalize_scene(doc)
check("нормализация двигает конфликтующий декор",
      bool(changes) and not [i for i in issues if i.get("level") == "error"],
      {"changes": changes, "issues": issues})

# --- 11. верх выше потолка ------------------------------------------------
doc = project([inst(H=2600, plinthH=100, worktopT=38)])
issues = validate_layout(doc)
check("верх выше потолка — ошибка", "above-ceiling" in codes(issues), issues)

# --- 11.1. настенный предмет закрыт мебелью ------------------------------
doc = project([inst("i1", x=0, y=3440)])
doc["room"]["wallItems"] = [{
    "id": "socket", "kind": "socket", "wall": 2, "x": 3400,
    "z": 300, "w": 200, "h": 80, "depth": 12,
}]
issues = validate_scene(doc)
check("розетка закрыта мебелью — ошибка", "wallitem" in codes(issues), issues)

# --- 11.1. дверь: зона не меньше ширины полотна -------------------------
doc = project(
    props=[prop("p1", kind="plant", x=1800, y=800, w=300, d=300, h=800)],
    openings=[{"id": "d1", "kind": "door", "wall": 0, "x": 1400,
               "w": 900, "z0": 0, "z1": 2100}],
)
issues = validate_scene(doc)
check("декор в 800 мм от двери — ошибка (полотно 900)",
      "prop-opening" in codes(issues), issues)

# --- 11.2. проёмы не пересекаются ----------------------------------------
doc = project(openings=[
    {"id": "d1", "kind": "door", "wall": 0, "x": 1000, "w": 900,
     "z0": 0, "z1": 2100},
    {"id": "d2", "kind": "door", "wall": 0, "x": 1500, "w": 900,
     "z0": 0, "z1": 2100},
])
issues = validate_scene(doc)
check("два проёма пересекаются — ошибка",
      "opening-overlap" in codes(issues), issues)

# --- 11.3. розетка внутри дверного проёма --------------------------------
doc = project(openings=[
    {"id": "d1", "kind": "door", "wall": 0, "x": 1000, "w": 900,
     "z0": 0, "z1": 2100},
])
doc["room"]["wallItems"] = [{
    "id": "socket", "kind": "socket", "wall": 0, "x": 1200,
    "z": 300, "w": 200, "h": 80, "depth": 12,
}]
issues = validate_scene(doc)
check("розетка в дверном проёме — ошибка",
      "wallitem-opening" in codes(issues), issues)

# --- 11.4. настенный предмет вне стены / пересекает другой --------------
doc = project()
doc["room"]["wallItems"] = [{
    "id": "socket", "kind": "socket", "wall": 0, "x": 3900,
    "z": 300, "w": 300, "h": 80, "depth": 12,
}]
issues = validate_scene(doc)
check("розетка за длиной стены — ошибка",
      "wallitem-outside" in codes(issues), issues)

doc = project()
doc["room"]["wallItems"] = [
    {"id": "a", "kind": "socket", "wall": 0, "x": 1000,
     "z": 300, "w": 300, "h": 80, "depth": 12},
    {"id": "b", "kind": "shelf", "wall": 0, "x": 1100,
     "z": 300, "w": 300, "h": 80, "depth": 12},
]
issues = validate_scene(doc)
check("настенные предметы пересекаются — ошибка",
      "wallitem-wallitem" in codes(issues), issues)

# --- 11.5. розетка над мойкой/варочной ------------------------------------
doc = project([inst("i1", "Варочная 600", x=600, y=0, rot=180,
                    cutouts=[{"x": 80, "y": 120, "w": 440, "h": 320}])])
doc["room"]["wallItems"] = [{
    "id": "w1", "kind": "socket", "wall": 0, "x": 300, "z": 1150,
    "w": 80, "h": 80,
}]
issues = validate_scene(doc)
check("розетка над варочной — ошибка",
      "socket-over-cutout" in codes(issues), issues)

doc = project([inst("i1", "Тумба 600", x=600, y=0, rot=180)])
doc["room"]["wallItems"] = [{
    "id": "w1", "kind": "socket", "wall": 0, "x": 300, "z": 1150,
    "w": 80, "h": 80,
}]
issues = validate_scene(doc)
check("розетка над обычной тумбой — без ошибки",
      "socket-over-cutout" not in codes(issues), issues)

# --- 11.6. ряд не доходит до стены / шкаф у окна -------------------------
def row_doc(offset: float):
    """Один модуль 600 у левой стены; offset — щель слева."""
    return project([inst("i1", x=offset + 600, y=560, rot=180, W=600)])

issues = validate_scene(row_doc(130))
check("щель 130 мм у стены — предупреждение",
      "row-gap-wall" in codes(issues), issues)
issues = validate_scene(row_doc(20))
check("угловой зазор 20 мм — без предупреждения",
      "row-gap-wall" not in codes(issues), issues)

# навесной шкаф рядом с окном: < 80 мм — предупреждение, перекрытие — ошибка
def win_doc(unit_x: float):
    doc = project(
        [inst("i1", "Навесной 600", x=unit_x + 600, y=320, rot=180, W=600, D=320,
              mount="wall", z=1450, plinthH=0, worktopT=0)],
        openings=[{"id": "o1", "kind": "window", "wall": 0, "x": 0,
                   "w": 700, "z0": 900, "z1": 2200}],
    )
    doc["instances"][0]["z"] = 1450
    return doc

issues = validate_scene(win_doc(740))   # 40 мм от окна
check("шкаф в 40 мм от окна — предупреждение",
      "cabinet-window-gap" in codes(issues), issues)
issues = validate_scene(win_doc(600))   # перекрывает окно
check("шкаф перекрывает окно — ошибка",
      "cabinet-window" in codes(issues), issues)

# мойка у самой боковой стены
doc = project([inst("i1", "Мойка 800", x=820, y=560, rot=180, W=800,
                    cutouts=[{"x": 170, "y": 150, "w": 460, "h": 380}])])
issues = validate_scene(doc)
check("мойка в 20 мм от боковой стены — предупреждение",
      "sink-corner" in codes(issues), issues)

# --- 12. корпус прямо на двери комнаты -----------------------------------
doc = project(
    [inst("i1", x=1500, y=0, rot=180)],
    openings=[{"id": "d1", "kind": "door", "wall": 0, "x": 1400,
               "w": 900, "z0": 0, "z1": 2100}],
)
issues = validate_layout(doc) + validate_scene(doc)
check("корпус на двери комнаты — ошибка", "opening" in codes(issues), issues)

# --- 13. дверь фасада упирается в стену ----------------------------------
doc = project([inst("i1", x=200, y=500, rot=270, doors=1)])
issues = validate_scene(doc)
check("дверь фасада упирается в стену — ошибка",
      "door-swing-wall" in codes(issues), issues)

# --- 14. демо-квартира должна быть чистой --------------------------------
for demo_name in ("demo-apartment", "demo"):
    demo = json.loads((ROOT / "projects" / demo_name / "project.json")
                      .read_text(encoding="utf-8"))
    all_issues = validate_layout(demo) + validate_scene(demo)
    check(f"{demo_name}: 0 ошибок", not errors(all_issues),
          errors(all_issues))

print()
if not ok:
    raise SystemExit(1)
print("Все проверки пройдены.")
