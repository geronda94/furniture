"""Пакетные правки проекта для UI и ИИ-агентов."""
from __future__ import annotations

from .common import new_id

DEFAULT_PARAMS = {
    "W": 800, "H": 720, "D": 560, "doors": 2, "drawers": 0, "shelves": 2,
    "frame": "inset", "hardware": "blum", "runners": "tandem-21",
    "t": 16, "back": "dvp", "backT": 4, "roof": True, "reinforce": "auto",
    "mount": "floor", "plinthH": 100, "worktopT": 38,
    "gapSide": 2, "gapBetween": 3, "gapTop": 2, "gapBottom": 2,
    "handle": "bar-128",
    "fastener": "auto",
    "facadeMaterial": "ldsp",
    "facadeStyle": "handle",
    "hiddenFasteners": False,
    "connectionOverrides": {},
    "edges": {},
    "shelfSupport": "system32",
    "gasStrut": "",
    "legMount": "leg-plate-60",
    "system32": True,
}

MODULE_PRESETS = [
    {"key": "base600", "label": "Тумба 600", "group": "Тумбы",
     "params": {"W": 600, "doors": 1, "shelves": 1}},
    {"key": "base800", "label": "Тумба 800", "group": "Тумбы",
     "params": {"W": 800, "doors": 2, "shelves": 2}},
    {"key": "drawers600", "label": "Ящики 600", "group": "Ящики",
     "params": {"W": 600, "doors": 0, "drawers": 3, "shelves": 0}},
    {"key": "drawers-cabinet", "label": "Тумба с ящиками", "group": "Ящики",
     "params": {"W": 600, "doors": 0, "drawers": 3, "shelves": 0,
                "runners": "tandem-21"}},
    {"key": "sink800", "label": "Мойка 800", "group": "Мойки",
     "params": {"W": 800, "doors": 2, "shelves": 1}},
    {"key": "wardrobe1200", "label": "Шкаф 1200", "group": "Шкафы",
     "params": {"W": 1200, "H": 2400, "D": 600, "doors": 3, "shelves": 5}},
    {"key": "chest900", "label": "Комод 900", "group": "Комоды",
     "params": {"W": 900, "H": 900, "D": 500, "doors": 0, "drawers": 3,
                "shelves": 0}},
    {"key": "nightstand", "label": "Тумба 450", "group": "Тумбы",
     "params": {"W": 450, "H": 550, "D": 400, "doors": 1, "shelves": 1}},
    {"key": "tall600", "label": "Пенал 600", "group": "Пеналы",
     "params": {"W": 600, "H": 2100, "D": 560, "doors": 2, "shelves": 4}},
    {"key": "open600", "label": "Открытая 600", "group": "Открытые",
     "params": {"W": 600, "H": 720, "D": 560, "doors": 0, "shelves": 3}},
    {"key": "island", "label": "Остров 1200", "group": "Острова",
     "params": {"W": 1200, "H": 720, "D": 700, "doors": 2, "shelves": 2,
                "plinthH": 0}},
    {"key": "wall600", "label": "Навесной 600", "group": "Навесные",
     "params": {"W": 600, "H": 720, "D": 300, "doors": 2, "shelves": 2,
                "mount": "wall"}},
    {"key": "wall800", "label": "Навесной 800", "group": "Навесные",
     "params": {"W": 800, "H": 720, "D": 300, "doors": 2, "shelves": 3,
                "mount": "wall"}},
    {"key": "mix900", "label": "Микс 900", "group": "Комбинированные",
     "params": {"W": 900, "doors": 2, "drawers": 1, "shelves": 2}},
]




def apply_action(doc: dict, act: dict) -> dict:
    op = act.get("op")
    if op == "add_instance":
        preset = next((p for p in MODULE_PRESETS
                       if p["key"] == act.get("preset")), MODULE_PRESETS[0])
        globals_ = {k: v for k, v in (doc.get("globals") or {}).items()
                    if k != "autoApply"}
        params = {**DEFAULT_PARAMS, **globals_,
                  **preset["params"], **(act.get("params") or {})}
        inst = {
            "id": new_id("i"), "product": "base-cabinet",
            "name": act.get("name") or f"Модуль {len(doc.get('instances', [])) + 1}",
            "x": float(act.get("x", 50)), "y": float(act.get("y", 50)),
            "z": float(act.get("z", 0)), "rot": float(act.get("rot", 0)),
            "zLocked": bool(act.get("zLocked", True)), "params": params,
        }
        doc.setdefault("instances", []).append(inst)
        return {"op": op, "id": inst["id"]}
    if op == "update_instance":
        inst = next((i for i in doc.get("instances", [])
                     if i.get("id") == act.get("id")), None)
        if not inst:
            raise ValueError(f"нет модуля {act.get('id')}")
        for k in ("x", "y", "z", "rot", "name"):
            if k in act:
                inst[k] = act[k]
        if isinstance(act.get("params"), dict):
            inst["params"] = {**inst.get("params", {}), **act["params"]}
        return {"op": op, "id": inst["id"]}
    if op == "delete_instance":
        before = len(doc.get("instances", []))
        doc["instances"] = [i for i in doc.get("instances", [])
                            if i.get("id") != act.get("id")]
        return {"op": op, "removed": before - len(doc["instances"])}
    if op == "add_opening":
        room = doc.setdefault("room", {})
        kind = act.get("kind", "window")
        wall = int(act.get("wall", 3 if kind == "door" else 0))
        w = float(act.get("w", 900 if kind == "door" else 1200))
        o = {
            "id": new_id("o"), "kind": kind, "wall": wall,
            "x": float(act.get("x", 0)), "w": w,
            "z0": float(act.get("z0", 0 if kind == "door" else 900)),
            "z1": float(act.get("z1", 2100 if kind == "door" else 2200)),
        }
        if kind == "door":
            o["hinge"] = act.get("hinge", "left")
            o["angle"] = float(act.get("angle", 80))
            o["open"] = bool(act.get("open", False))
        room.setdefault("openings", []).append(o)
        return {"op": op, "id": o["id"]}
    if op == "set_room":
        room = doc.setdefault("room", {})
        room.update(act.get("patch") or {})
        return {"op": op}
    if op == "set_globals":
        globals_ = doc.setdefault("globals", {})
        patch = act.get("patch") or {}
        globals_.update(patch)
        for inst in doc.get("instances", []):
            params = inst.setdefault("params", {})
            overrides = inst.get("overrides") or []
            for key, value in patch.items():
                if key in DEFAULT_PARAMS and key not in overrides:
                    params[key] = value
        return {"op": op}
    raise ValueError(f"неизвестная операция: {op}")


