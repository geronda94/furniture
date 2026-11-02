"""Пакетные правки проекта для UI и ИИ-агентов."""
from __future__ import annotations

from .common import new_id
from .placement import (
    candidate_free,
    find_free_placement,
    find_free_prop_placement,
    find_free_wall_item,
    prop_free,
    wall_item_free,
)

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
        room = doc.setdefault("room", {})
        instances = doc.setdefault("instances", [])
        props = doc.get("props", [])
        W = float(params.get("W") or 800)
        D = float(params.get("D") or 560)
        H = float(params.get("H") or 720)
        mount = str(params.get("mount") or "floor")
        z = float(act.get("z", 1450 if mount == "wall" else 0))
        has_xy = act.get("x") is not None and act.get("y") is not None
        if has_xy:
            x = float(act["x"])
            y = float(act["y"])
            rot = float(act.get("rot", 0))
            if not candidate_free(
                room, instances, props, x, y, rot, W, D, H, mount,
                float(params.get("plinthH") or 0),
                float(params.get("worktopT") or 0), z,
            ):
                free = find_free_placement(
                    room, instances, props, W, D, H, mount=mount,
                    plinthH=float(params.get("plinthH") or 0),
                    worktopT=float(params.get("worktopT") or 0),
                )
                hint = (
                    f" Свободное место: x={free[0]}, y={free[1]}, rot={free[2]}."
                    if free else " Свободного места у стен нет."
                )
                raise ValueError(
                    "модуль пересекает стену, проём, мебель или декор." + hint,
                )
        else:
            free = find_free_placement(
                room, instances, props, W, D, H, mount=mount,
                plinthH=float(params.get("plinthH") or 0),
                worktopT=float(params.get("worktopT") or 0),
            )
            if not free:
                raise ValueError("нет свободного места у стен для нового модуля")
            x, y, rot = free
        inst = {
            "id": new_id("i"), "product": "base-cabinet",
            "name": act.get("name") or f"Модуль {len(instances) + 1}",
            "x": round(x, 1), "y": round(y, 1), "z": round(z, 1),
            "rot": round(rot, 1),
            "zLocked": bool(act.get("zLocked", True)), "params": params,
        }
        instances.append(inst)
        return {"op": op, "id": inst["id"], "x": inst["x"],
                "y": inst["y"], "rot": inst["rot"]}
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
    if op == "update_opening":
        room = doc.setdefault("room", {})
        entry = next((o for o in room.get("openings", [])
                      if o.get("id") == act.get("id")), None)
        if not entry:
            raise ValueError(f"нет проёма {act.get('id')}")
        entry.update(act.get("patch") or {})
        return {"op": op, "id": entry["id"]}
    if op == "delete_opening":
        room = doc.setdefault("room", {})
        before = len(room.get("openings", []))
        room["openings"] = [o for o in room.get("openings", [])
                            if o.get("id") != act.get("id")]
        return {"op": op, "removed": before - len(room["openings"])}
    if op == "add_wall_item":
        kind = act.get("kind", "socket")
        defaults = {
            "shelf": (600, 20, 200, 1000),
            "mirror": (600, 800, 20, 1200),
            "socket": (80, 80, 12, 300),
            "switch": (80, 80, 12, 1100),
        }
        w0, h0, d0, z0 = defaults.get(kind, (300, 300, 12, 900))
        room = doc.setdefault("room", {})
        instances = doc.get("instances", [])
        props = doc.get("props", [])
        wall_index = int(act.get("wall", 0))
        w = float(act.get("w", w0))
        h = float(act.get("h", h0))
        depth = float(act.get("depth", d0))
        z = float(act.get("z", z0))
        if act.get("x") is not None:
            x = float(act["x"])
            if not wall_item_free(
                room, instances, props, wall_index, x, z, w, h, depth,
                kind=kind,
            ):
                free = find_free_wall_item(
                    room, instances, props, wall_index, z, w, h, depth,
                    kind=kind,
                )
                hint = (
                    f" Свободное место на стене: x={free}."
                    if free is not None else " На этой стене нет места."
                )
                raise ValueError(
                    "предмет пересекает проём, мебель или другой предмет."
                    + hint,
                )
        else:
            free = find_free_wall_item(
                room, instances, props, wall_index, z, w, h, depth,
                kind=kind,
            )
            if free is None:
                raise ValueError("на этой стене нет свободного места")
            x = free
        item = {
            "id": new_id("wi"), "kind": kind,
            "wall": wall_index,
            "x": round(x, 1),
            "z": z, "w": w, "h": h, "depth": depth,
        }
        room.setdefault("wallItems", []).append(item)
        return {"op": op, "id": item["id"], "x": item["x"]}
    if op == "update_wall_item":
        room = doc.setdefault("room", {})
        item = next((i for i in room.get("wallItems", [])
                     if i.get("id") == act.get("id")), None)
        if not item:
            raise ValueError(f"нет предмета {act.get('id')}")
        patch = act.get("patch") or {}
        merged = {**item, **patch}
        if not wall_item_free(
            room, doc.get("instances", []), doc.get("props", []),
            int(merged.get("wall", 0)),
            float(merged.get("x", 0)), float(merged.get("z", 0)),
            float(merged.get("w", 0)), float(merged.get("h", 0)),
            float(merged.get("depth", 12)),
            kind=str(merged.get("kind") or "socket"),
            ignore=str(item.get("id")),
        ):
            raise ValueError(
                "предмет пересекает проём, мебель или другой предмет",
            )
        item.update(patch)
        return {"op": op, "id": item["id"]}
    if op == "delete_wall_item":
        room = doc.setdefault("room", {})
        before = len(room.get("wallItems", []))
        room["wallItems"] = [i for i in room.get("wallItems", [])
                             if i.get("id") != act.get("id")]
        return {"op": op, "removed": before - len(room["wallItems"])}
    if op == "add_decor":
        kind = act.get("type", "plant")
        room = doc.setdefault("room", {})
        instances = doc.get("instances", [])
        props = doc.setdefault("props", [])
        w = float(act.get("w", 400))
        d = float(act.get("d", 400))
        h = float(act.get("h", 800))
        z = float(act.get("z", 0))
        rot = float(act.get("rot", 0))
        has_xy = act.get("x") is not None and act.get("y") is not None
        if has_xy:
            x = float(act["x"])
            y = float(act["y"])
            if not prop_free(room, instances, props, x, y, rot,
                             w, d, h, z, kind=kind):
                free = find_free_prop_placement(
                    room, instances, props, w, d, h, kind=kind, z=z)
                hint = (
                    f" Свободное место: x={free[0]}, y={free[1]}."
                    if free else " Свободного места в комнате нет."
                )
                raise ValueError(
                    "декор пересекает стену, проём, мебель или другой "
                    "декор." + hint,
                )
        else:
            free = find_free_prop_placement(
                room, instances, props, w, d, h, kind=kind, z=z)
            if not free:
                raise ValueError("нет свободного места для декора")
            x, y = free
        prop = {
            "id": new_id("p"), "type": kind,
            "name": act.get("name") or "Декор",
            "x": round(x, 1), "y": round(y, 1),
            "z": z, "rot": rot,
            "w": w, "d": d, "h": h,
            "color": act.get("color") or "#7a8a6a",
        }
        if act.get("accent"):
            prop["accent"] = act["accent"]
        props.append(prop)
        return {"op": op, "id": prop["id"], "x": prop["x"], "y": prop["y"]}
    if op == "update_decor":
        prop = next((p for p in doc.get("props", [])
                     if p.get("id") == act.get("id")), None)
        if not prop:
            raise ValueError(f"нет декора {act.get('id')}")
        patch = act.get("patch") or {}
        merged = {**prop, **patch}
        room = doc.setdefault("room", {})
        instances = doc.get("instances", [])
        props = doc.get("props", [])
        if not prop_free(
            room, instances, props,
            float(merged.get("x", 0)), float(merged.get("y", 0)),
            float(merged.get("rot", 0)),
            float(merged.get("w", 0)), float(merged.get("d", 0)),
            float(merged.get("h", 0)), float(merged.get("z", 0)),
            kind=str(merged.get("type") or "decor"),
            ignore=str(prop.get("id")),
        ):
            raise ValueError(
                "декор пересекает стену, проём, мебель или другой декор",
            )
        prop.update(patch)
        return {"op": op, "id": prop["id"]}
    if op == "delete_decor":
        before = len(doc.get("props", []))
        doc["props"] = [p for p in doc.get("props", [])
                        if p.get("id") != act.get("id")]
        return {"op": op, "removed": before - len(doc["props"])}
    if op == "set_materials":
        mats = doc.setdefault("materials", {})
        mats.update(act.get("materials") or {})
        return {"op": op}
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


