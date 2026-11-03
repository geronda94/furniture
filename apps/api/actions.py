"""Пакетные правки проекта для UI и ИИ-агентов."""
from __future__ import annotations

import copy
import math
from typing import Any

from furniture_core.layout import normalize_layout, room_walls
from furniture_core.scene import normalize_scene

from .common import new_id
from .decor import decor_presets
from .fixes import fix_issues as apply_issue_fixes
from .placement import (
    GEOMETRY_KEYS,
    candidate_free,
    find_free_placement,
    find_free_prop_placement,
    find_free_wall_item,
    height_problem,
    prop_free,
    scene_context,
    wall_item_free,
)
from .quickstart import _place
from .room import (
    add_opening as room_add_opening,
    add_partition as room_add_partition,
    delete_partition as room_delete_partition,
    resize_room as room_resize,
    update_opening as room_update_opening,
    update_partition as room_update_partition,
    wall_at,
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

MATERIAL_ROLES = {
    "corpus", "facade", "worktop", "plinth", "back", "drawer",
    "floor", "ceiling",
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
     "params": {"W": 1200, "H": 2400, "D": 600, "doors": 3, "shelves": 5,
                "dividers": 1, "worktopT": 0}},
    {"key": "chest900", "label": "Комод 900", "group": "Комоды",
     "params": {"W": 900, "H": 900, "D": 500, "doors": 0, "drawers": 3,
                "shelves": 0, "worktopT": 0}},
    {"key": "nightstand", "label": "Тумба 450", "group": "Тумбы",
     "params": {"W": 450, "H": 550, "D": 400, "doors": 1, "shelves": 1,
                "worktopT": 0}},
    {"key": "tall600", "label": "Пенал 600", "group": "Пеналы",
     "params": {"W": 600, "H": 2100, "D": 560, "doors": 2, "shelves": 4,
                "worktopT": 0}},
    {"key": "open600", "label": "Открытая 600", "group": "Открытые",
     "params": {"W": 600, "H": 720, "D": 560, "doors": 0, "shelves": 3}},
    {"key": "island", "label": "Остров 1200", "group": "Острова",
     "params": {"W": 1200, "H": 862, "D": 700, "doors": 2, "shelves": 2,
                "dividers": 1, "plinthH": 0}},
    {"key": "wall600", "label": "Навесной 600", "group": "Навесные",
     "params": {"W": 600, "H": 720, "D": 300, "doors": 2, "shelves": 2,
                "mount": "wall"}},
    {"key": "wall800", "label": "Навесной 800", "group": "Навесные",
     "params": {"W": 800, "H": 720, "D": 300, "doors": 2, "shelves": 3,
                "mount": "wall"}},
    {"key": "mix900", "label": "Микс 900", "group": "Комбинированные",
     "params": {"W": 900, "doors": 2, "drawers": 1, "shelves": 2}},
]




def params_for(doc: dict, act: dict) -> dict:
    """Параметры модуля: DEFAULT_PARAMS → globals → пресет → params."""
    preset = next((p for p in MODULE_PRESETS
                   if p["key"] == act.get("preset")), MODULE_PRESETS[0])
    globals_ = {k: v for k, v in (doc.get("globals") or {}).items()
                if k != "autoApply"}
    params = {**DEFAULT_PARAMS, **globals_}
    if preset:
        params.update(preset["params"])
    params.update(act.get("params") or {})
    return params


def apply_action(doc: dict, act: dict) -> dict:
    op = act.get("op")
    if op == "add_instance":
        params = params_for(doc, act)
        room = doc.setdefault("room", {})
        instances = doc.setdefault("instances", [])
        props = doc.get("props", [])
        W = float(params.get("W") or 800)
        D = float(params.get("D") or 560)
        H = float(params.get("H") or 720)
        mount = str(params.get("mount") or "floor")
        z = float(act.get("z", 1450 if mount == "wall" else 0))
        has_x = act.get("x") is not None
        has_y = act.get("y") is not None
        if has_x != has_y:
            raise ValueError(
                "нужны обе координаты x и y (или ни одной — тогда сервер "
                "сам подберёт свободное место)",
            )
        has_xy = has_x and has_y
        if has_xy:
            x = float(act["x"])
            y = float(act["y"])
            rot = float(act.get("rot", 0))
            if not candidate_free(
                room, instances, props, x, y, rot, W, D, H, mount,
                float(params.get("plinthH") or 0),
                float(params.get("worktopT") or 0), z,
                params=params,
            ):
                free = find_free_placement(
                    room, instances, props, W, D, H, mount=mount,
                    plinthH=float(params.get("plinthH") or 0),
                    worktopT=float(params.get("worktopT") or 0),
                    params=params,
                )
                hint = (
                    f" Свободное место: x={free[0]}, y={free[1]}, rot={free[2]}."
                    if free else
                    " " + (height_problem(
                        room, H, mount,
                        float(params.get("plinthH") or 0),
                        float(params.get("worktopT") or 0),
                    ) or "Свободного места у стен нет.")
                )
                raise ValueError(
                    "модуль пересекает стену, проём, мебель или декор." + hint,
                )
        else:
            free = find_free_placement(
                room, instances, props, W, D, H, mount=mount,
                plinthH=float(params.get("plinthH") or 0),
                worktopT=float(params.get("worktopT") or 0),
                params=params,
            )
            if not free:
                raise ValueError(
                    height_problem(
                        room, H, mount,
                        float(params.get("plinthH") or 0),
                        float(params.get("worktopT") or 0),
                    ) or "нет свободного места у стен для нового модуля",
                )
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
        patch = act.get("params") if isinstance(act.get("params"), dict) else None
        # Материалы/название объём не меняют — их можно менять без проверки.
        geom_changed = any(k in act for k in ("x", "y", "z", "rot"))
        if patch:
            geom_changed = geom_changed or any(k in GEOMETRY_KEYS for k in patch)
        if geom_changed:
            merged = {
                **inst,
                **{k: act[k] for k in ("x", "y", "z", "rot") if k in act},
            }
            if patch:
                merged["params"] = {**inst.get("params", {}), **patch}
            p = merged.get("params") or {}
            W = float(p.get("W") or 800)
            D = float(p.get("D") or 560)
            H = float(p.get("H") or 720)
            mount = str(p.get("mount") or "floor")
            plinth = float(p.get("plinthH") or 0)
            worktop = float(p.get("worktopT") or 0)
            room = doc.get("room") or {}
            others = [i for i in doc.get("instances", [])
                      if i.get("id") != inst.get("id")]
            if not candidate_free(
                room, others, doc.get("props", []),
                float(merged.get("x") or 0), float(merged.get("y") or 0),
                float(merged.get("rot") or 0), W, D, H, mount,
                plinth, worktop, float(merged.get("z") or 0),
                params=p,
            ):
                free = find_free_placement(
                    room, others, doc.get("props", []), W, D, H,
                    mount=mount, plinthH=plinth, worktopT=worktop,
                    params=p,
                )
                hint = (
                    f" Свободное место: x={free[0]}, y={free[1]}, rot={free[2]}."
                    if free else
                    " " + (height_problem(room, H, mount, plinth, worktop)
                           or "Свободного места у стен нет.")
                )
                raise ValueError(
                    "после изменения модуль пересекает стену, проём, мебель, "
                    "декор или выходит за комнату." + hint,
                )
        for k in ("x", "y", "z", "rot", "name"):
            if k in act:
                inst[k] = act[k]
        if patch:
            inst["params"] = {**inst.get("params", {}), **patch}
        return {"op": op, "id": inst["id"]}
    if op == "delete_instance":
        before = len(doc.get("instances", []))
        doc["instances"] = [i for i in doc.get("instances", [])
                            if i.get("id") != act.get("id")]
        return {"op": op, "removed": before - len(doc["instances"])}
    if op == "add_opening":
        return room_add_opening(doc, act)
    if op == "update_opening":
        return room_update_opening(doc, act)
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
        presets = decor_presets()
        preset = (next((p for p in presets if p.get("key") == kind), None)
                  or next((p for p in presets if p.get("type") == kind), None))
        room = doc.setdefault("room", {})
        instances = doc.get("instances", [])
        props = doc.setdefault("props", [])
        # Размеры и цвет по умолчанию — из specs/decor.yaml, а не 400×400×800
        # для любого типа (иначе кровать/диван получают бессмысленный габарит).
        w = float(act.get("w") or (preset or {}).get("w") or 400)
        d = float(act.get("d") or (preset or {}).get("d") or 400)
        h = float(act.get("h") or (preset or {}).get("h") or 800)
        z = float(act.get("z", 0))
        rot = float(act.get("rot", 0))
        has_x = act.get("x") is not None
        has_y = act.get("y") is not None
        if has_x != has_y:
            raise ValueError(
                "нужны обе координаты x и y (или ни одной — тогда сервер "
                "сам подберёт свободное место)",
            )
        has_xy = has_x and has_y
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
            "name": act.get("name") or (preset or {}).get("name") or "Декор",
            "x": round(x, 1), "y": round(y, 1),
            "z": z, "rot": rot,
            "w": w, "d": d, "h": h,
            "color": (act.get("color") or (preset or {}).get("color")
                      or "#7a8a6a"),
        }
        accent = act.get("accent") or (preset or {}).get("accent")
        if accent:
            prop["accent"] = accent
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
        # Геометрию комнаты меняем через resize_room: он пересобирает контур
        # и подгоняет проёмы/предметы. Здесь — только настройки поверхностей.
        patch = dict(act.get("patch") or {})
        for key in ("partitions", "openings", "wallItems"):
            if key in patch:
                raise ValueError(
                    f"для {key} есть отдельные операции: add/update/delete",
                )
        keys = ("w", "d", "h", "wallT", "outline", "shape", "cutW", "cutD")
        result: dict[str, Any] = {"op": op}
        geometry = {k: patch[k] for k in keys if k in patch}
        if geometry:
            result.update(room_resize(doc, geometry))
            result["op"] = op
        extra = {k: v for k, v in patch.items() if k not in keys}
        if extra:
            doc.setdefault("room", {}).update(extra)
        return result
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
    if op == "add_row":
        room = doc.setdefault("room", {})
        instances = doc.setdefault("instances", [])
        props = doc.get("props", [])
        wall_index = int(act.get("wall") or 0)
        wall = next((w for w in room_walls(room)
                     if w.index == wall_index), None)
        if wall is None:
            raise ValueError(
                f"нет стены №{wall_index + 1}; доступны 0…"
                f"{len(room_walls(room)) - 1}",
            )
        items = act.get("items") or []
        if not isinstance(items, list) or not items:
            raise ValueError("add_row: нужен непустой items[]")
        cursor = float(act.get("start") if act.get("start") is not None
                       else 20.0)
        gap = float(act.get("gap") or 0)
        created: list[dict] = []
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("add_row: каждый item — объект")
            params = params_for(doc, item)
            W = float(params.get("W") or 600)
            D = float(params.get("D") or 560)
            H = float(params.get("H") or 720)
            mount = str(params.get("mount") or "floor")
            plinth = float(params.get("plinthH") or 0)
            worktop = float(params.get("worktopT") or 0)
            z = float(item.get("z", 1450 if mount == "wall" else 0))
            ctx = scene_context(room, instances + created, props)
            start = cursor
            found = None
            while start + W <= wall.length + 0.5:
                x, y, rot = _place(wall, start, W, D)
                if candidate_free(
                    room, instances + created, props, x, y, rot, W, D, H,
                    mount, plinth, worktop, z, params=params, ctx=ctx,
                ):
                    found = (start, x, y, rot)
                    break
                start += 10
            if found is None:
                name = str(item.get("name") or item.get("preset") or "модуль")
                raise ValueError(
                    f"ряд: «{name}» {W:.0f} мм не помещается на стене "
                    f"№{wall_index + 1} после x={cursor:.0f} мм "
                    f"(длина {wall.length:.0f} мм). Уменьшите ширину или "
                    "выберите другую стену.",
                )
            start, x, y, rot = found
            preset = next((pr for pr in MODULE_PRESETS
                           if pr["key"] == item.get("preset")), None)
            name = (item.get("name")
                    or (preset["label"] if preset else None)
                    or f"Модуль {len(instances) + len(created) + 1}")
            inst = {
                "id": new_id("i"), "product": "base-cabinet",
                "name": str(name),
                "x": round(x, 1), "y": round(y, 1), "z": round(z, 1),
                "rot": round(rot, 1), "zLocked": True, "params": params,
            }
            created.append(inst)
            cursor = start + W + gap
        instances.extend(created)
        return {"op": op, "ids": [i["id"] for i in created],
                "count": len(created),
                "x": [i["x"] for i in created]}
    if op == "fit_module":
        inst = next((i for i in doc.get("instances", [])
                     if i.get("id") == act.get("id")), None)
        if not inst:
            raise ValueError(f"нет модуля {act.get('id')}")
        p = inst.setdefault("params", {})
        mount = str(p.get("mount") or "floor")
        room_h = float((doc.get("room") or {}).get("h") or 2700)
        z = float(inst.get("z") or 0)
        plinth = float(p.get("plinthH") or 0) if mount != "wall" else 0.0
        worktop = float(p.get("worktopT") or 0) if mount != "wall" else 0.0
        mode = str(act.get("to") or "ceiling")
        if mode == "ceiling":
            target = room_h
        elif mode == "worktop":
            target = float(act.get("target") or 900)
        else:
            raise ValueError("fit_module: to = ceiling | worktop")
        H = max(120.0, round(target - z - plinth - worktop))
        old_h = float(p.get("H") or 0)
        p["H"] = H
        others = [i for i in doc.get("instances", [])
                  if i.get("id") != inst.get("id")]
        if not candidate_free(
            doc.get("room") or {}, others, doc.get("props", []),
            float(inst.get("x") or 0), float(inst.get("y") or 0),
            float(inst.get("rot") or 0), float(p.get("W") or 600),
            float(p.get("D") or 560), H, mount, plinth, worktop, z,
            params=p,
        ):
            p["H"] = old_h
            raise ValueError(
                "после подгонки высоты модуль куда-то упирается — "
                "проверьте позицию",
            )
        return {"op": op, "id": inst["id"], "H": H,
                "surface": round(z + plinth + H + worktop, 1)}
    if op == "duplicate_instance":
        src = next((i for i in doc.get("instances", [])
                    if i.get("id") == act.get("id")), None)
        if not src:
            raise ValueError(f"нет модуля {act.get('id')}")
        copy_inst = copy.deepcopy(src)
        copy_inst["id"] = new_id("i")
        copy_inst["name"] = str(
            act.get("name") or f"{src.get('name') or 'Модуль'} (копия)",
        )
        p = copy_inst.setdefault("params", {})
        W = float(p.get("W") or 600)
        D = float(p.get("D") or 560)
        H = float(p.get("H") or 720)
        mount = str(p.get("mount") or "floor")
        plinth = float(p.get("plinthH") or 0)
        worktop = float(p.get("worktopT") or 0)
        z = float(copy_inst.get("z") or 0)
        rot = float(copy_inst.get("rot") or 0)
        room = doc.get("room") or {}
        instances = doc.get("instances", [])
        props = doc.get("props", [])
        a = math.radians(rot)
        cs, sn = math.cos(a), math.sin(a)
        x0, y0 = float(src.get("x") or 0), float(src.get("y") or 0)
        placed = None
        # сначала пробуем вплотную справа/слева от оригинала
        for sign in (1.0, -1.0):
            nx = x0 + sign * W * cs
            ny = y0 + sign * W * sn
            if candidate_free(
                room, instances, props, nx, ny, rot, W, D, H, mount,
                plinth, worktop, z, params=p,
            ):
                placed = (nx, ny, rot)
                break
        if placed is None:
            free = find_free_placement(
                room, instances, props, W, D, H, mount=mount,
                plinthH=plinth, worktopT=worktop, params=p,
            )
            if free is None:
                raise ValueError(
                    "не удалось найти свободное место для копии модуля",
                )
            placed = free
        copy_inst["x"] = round(placed[0], 1)
        copy_inst["y"] = round(placed[1], 1)
        copy_inst["rot"] = round(placed[2], 1)
        instances.append(copy_inst)
        return {"op": op, "id": copy_inst["id"],
                "x": copy_inst["x"], "y": copy_inst["y"],
                "rot": copy_inst["rot"]}
    if op == "resize_room":
        return room_resize(doc, act)
    if op == "add_partition":
        return room_add_partition(doc, act)
    if op == "update_partition":
        return room_update_partition(doc, act)
    if op == "delete_partition":
        return room_delete_partition(doc, act)
    if op == "normalize_layout":
        fixed, changes, _ = normalize_layout(
            doc, close_gaps=bool(act.get("close_gaps", True)),
        )
        if act.get("fix_decor", True):
            fixed, decor_changes, _ = normalize_scene(fixed)
            changes += decor_changes
        doc.clear()
        doc.update(fixed)
        return {"op": op, "changes": changes}
    if op == "fix_issues":
        items = [i for i in (act.get("issues") or []) if isinstance(i, dict)]
        applied, skipped = apply_issue_fixes(doc, items)
        changes: list[dict] = []
        if act.get("normalize", True):
            fixed, norm_changes, _ = normalize_layout(doc, close_gaps=True)
            fixed, decor_changes, _ = normalize_scene(fixed)
            changes = norm_changes + decor_changes
            doc.clear()
            doc.update(fixed)
        return {"op": op, "applied": applied, "skipped": skipped,
                "changes": changes}
    if op == "add_folder":
        ids = [str(x) for x in (act.get("ids") or [])]
        known = {str(i.get("id")) for i in doc.get("instances", [])}
        folder = {
            "id": new_id("f"),
            "name": str(act.get("name")
                        or f"Папка {len(doc.get('folders') or []) + 1}"),
            "ids": [x for x in ids if x in known],
        }
        doc.setdefault("folders", []).append(folder)
        return {"op": op, "id": folder["id"], "name": folder["name"]}
    if op == "update_folder":
        folder = next((f for f in doc.get("folders", [])
                       if f.get("id") == act.get("id")), None)
        if not folder:
            raise ValueError(f"нет папки {act.get('id')}")
        if act.get("name") is not None:
            folder["name"] = str(act["name"])
        if "ids" in act:
            known = {str(i.get("id")) for i in doc.get("instances", [])}
            folder["ids"] = [str(x) for x in (act.get("ids") or [])
                             if str(x) in known]
        return {"op": op, "id": folder["id"]}
    if op == "delete_folder":
        before = len(doc.get("folders", []))
        doc["folders"] = [f for f in doc.get("folders", [])
                          if f.get("id") != act.get("id")]
        return {"op": op, "removed": before - len(doc["folders"])}
    if op == "set_part_override":
        inst = next((i for i in doc.get("instances", [])
                     if i.get("id") == act.get("id")), None)
        if not inst:
            raise ValueError(f"нет модуля {act.get('id')}")
        uid = str(act.get("uid") or "")
        material = act.get("material")
        if not uid or not isinstance(material, dict) or not material:
            raise ValueError(
                "set_part_override: нужны uid детали и полный material",
            )
        overrides = inst.setdefault("partOverrides", {})
        overrides[uid] = dict(material)
        return {"op": op, "id": inst["id"], "uid": uid}
    if op == "reset_part_override":
        inst = next((i for i in doc.get("instances", [])
                     if i.get("id") == act.get("id")), None)
        if not inst:
            raise ValueError(f"нет модуля {act.get('id')}")
        uid = str(act.get("uid") or "")
        overrides = inst.get("partOverrides") or {}
        overrides.pop(uid, None)
        if overrides:
            inst["partOverrides"] = overrides
        else:
            inst.pop("partOverrides", None)
        return {"op": op, "id": inst["id"], "uid": uid}
    if op == "set_instance_material":
        inst = next((i for i in doc.get("instances", [])
                     if i.get("id") == act.get("id")), None)
        if not inst:
            raise ValueError(f"нет модуля {act.get('id')}")
        role = str(act.get("role") or "")
        if role not in MATERIAL_ROLES:
            raise ValueError(
                "роль материала: " + ", ".join(sorted(MATERIAL_ROLES)),
            )
        patch = dict(act.get("patch") or {})
        materials = inst.setdefault("materials", {})
        materials[role] = {**(materials.get(role) or {}), **patch}
        return {"op": op, "id": inst["id"], "role": role}
    if op == "rename_project":
        name = str(act.get("name") or "").strip()
        if not name:
            raise ValueError("название проекта не может быть пустым")
        doc["name"] = name[:120]
        return {"op": op, "name": doc["name"]}
    raise ValueError(f"неизвестная операция: {op}")


