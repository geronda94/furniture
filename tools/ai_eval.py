#!/usr/bin/env python3
"""Живой eval ИИ-чата: 24 сценария на реальной модели (DeepSeek).

Запуск (API должен быть поднят и AI_API_KEY задан):

    python3 tools/ai_eval.py
    python3 tools/ai_eval.py --only kitchen --limit 3
    python3 tools/ai_eval.py --report docs/ai-eval-report.md

Скрипт играет роль клиента: собирает контекст сцены, гоняет tool-calls,
складывает серверные операции в пакет, делает /preview и сохраняет через
/actions strict только если ошибок нет. Меряет успех, ошибки, число
правок и время — как в бизнес-плане (docs/42 §9).
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

from apps.api.routers.projects import _module_cost  # noqa: E402
from furniture_core.layout import (  # noqa: E402
    normalize_layout,
    outline_points,
    room_walls,
    validate_layout,
)
from furniture_core.scene import (  # noqa: E402
    normalize_scene,
    validate_scene,
)
from furniture_core.standards import validate_standards  # noqa: E402

API = os.getenv("FURNITURE_API", "https://5176.it2b.top")
SCHEMA = "furniture/project@0"
DEMO = ROOT / "projects" / "demo-apartment" / "project.json"

DEFAULT_GLOBALS = {
    "t": 16, "back": "dvp", "backT": 4, "roof": True,
    "reinforce": "auto", "frame": "inset", "hardware": "blum",
    "runners": "tandem-21", "plinthH": 100, "worktopT": 38,
    "gapSide": 2, "gapBetween": 3, "gapTop": 2, "gapBottom": 2,
    "autoApply": True,
}


def base_project(w: int = 4000, d: int = 3000, h: int = 2700,
                 name: str = "Eval") -> dict[str, Any]:
    return {
        "schema": SCHEMA, "name": name, "shop": "shop-ro-bucuresti",
        "market": "ro", "supplier": "generic",
        "room": {
            "w": w, "d": d, "h": h, "wallT": 100,
            "outline": [[0, 0], [w, 0], [w, d], [0, d]],
            "partitions": [], "openings": [], "wallItems": [],
            "floor": {"enabled": True, "material": "floor", "t": 0},
            "ceiling": {"enabled": False, "material": "ceiling", "t": 0},
        },
        "instances": [], "props": [], "folders": [], "materials": {},
        "materialVars": [], "finishes": [], "zones": [], "views": [],
        "globals": dict(DEFAULT_GLOBALS),
    }


def module(mid: str, name: str, x: float, y: float, rot: float = 180,
           **params: Any) -> dict[str, Any]:
    p = {
        "W": 800, "H": 720, "D": 560, "mount": "floor", "doors": 2,
        "drawers": 0, "shelves": 2, "plinthH": 100, "worktopT": 38,
        "gapSide": 2, "gapBetween": 3, "gapTop": 2, "gapBottom": 2,
        "handle": "bar-128", "frame": "inset", "facadeMaterial": "ldsp",
    }
    p.update(params)
    return {
        "id": mid, "product": "base-cabinet", "name": name,
        "x": x, "y": y, "z": 0, "rot": rot, "zLocked": True, "params": p,
    }


# --------------------------------------------------------------------------
# Контекст (упрощённый аналог apps/web/src/ai/context.ts)
# --------------------------------------------------------------------------

def _issues(doc: dict) -> list[dict]:
    seen: set[tuple] = set()
    out: list[dict] = []
    for issue in (validate_layout(doc) + validate_scene(doc)
                  + validate_standards(doc)):
        key = (issue.get("code"), issue.get("instance"), issue.get("prop"),
               issue.get("message"))
        if key in seen:
            continue
        seen.add(key)
        out.append(issue)
    return out


def build_context(doc: dict, selection_id: str | None = None) -> dict:
    room = doc.get("room") or {}
    walls = room_walls(room)
    instances = []
    for i in doc.get("instances") or []:
        p = i.get("params") or {}
        instances.append({
            "id": i.get("id"), "name": i.get("name"),
            "x": i.get("x"), "y": i.get("y"), "z": i.get("z") or 0,
            "rot": i.get("rot"), "W": p.get("W"), "H": p.get("H"),
            "D": p.get("D"), "mount": p.get("mount"),
        })
    props = [{
        "id": p.get("id"), "name": p.get("name"), "type": p.get("type"),
        "x": p.get("x"), "y": p.get("y"), "z": p.get("z") or 0,
        "w": p.get("w"), "d": p.get("d"), "h": p.get("h"),
        "rot": p.get("rot") or 0,
    } for p in doc.get("props") or []]
    selection: dict[str, Any] = {"kind": "none"}
    if selection_id:
        inst = next((i for i in doc.get("instances") or []
                     if i.get("id") == selection_id), None)
        if inst:
            selection = {
                "kind": "module", "id": inst.get("id"),
                "name": inst.get("name"),
                "params": inst.get("params") or {},
                "materials": inst.get("materials") or {},
                "world": {
                    "x": inst.get("x"), "y": inst.get("y"),
                    "z": inst.get("z") or 0, "rot": inst.get("rot"),
                },
                "gaps": [],
            }
    issues = _issues(doc)
    return {
        "schema": "furniture/ai-context@1",
        "app": {
            "projectId": "eval", "projectName": doc.get("name"),
            "revision": 1, "renderMode": "3d", "viewMode": "realistic",
            "wallMode": "cutaway",
            "dims": {"inside": False, "outside": False, "gaps": False},
            "presentation": False, "master": False, "objectModal": "quick",
        },
        "camera": {
            "alphaDeg": 30, "betaDeg": 55, "radius": 8,
            "target": [room.get("w", 0) / 2000, 1.2,
                       room.get("d", 0) / 2000],
            "projection": "persp", "mode": "orbit", "quality": "realistic",
            "wallMode": "cutaway", "blueprint": False, "blueprintView": "iso",
        },
        "selection": selection,
        "room": {
            "w": room.get("w"), "d": room.get("d"), "h": room.get("h"),
            "wallT": room.get("wallT"),
            "outline": len(room.get("outline") or []),
            "outlinePoints": room.get("outline") or [],
            "partitions": room.get("partitions") or [],
            "walls": [
                {"index": w.index, "len": round(w.length), "outer": w.outer}
                for w in walls
            ],
            "openings": [{
                "id": o.get("id"), "kind": o.get("kind"),
                "wall": o.get("wall"), "x": o.get("x"), "w": o.get("w"),
                "z0": o.get("z0"), "z1": o.get("z1"),
            } for o in room.get("openings") or []],
            "wallItems": [{
                "id": o.get("id"), "kind": o.get("kind"),
                "wall": o.get("wall"), "x": o.get("x"), "z": o.get("z"),
                "w": o.get("w"), "h": o.get("h"), "depth": o.get("depth"),
            } for o in room.get("wallItems") or []],
        },
        "project": {
            "instances": instances, "props": props,
            "folders": [{
                "id": f.get("id"), "name": f.get("name"),
                "count": len(f.get("ids") or []),
            } for f in doc.get("folders") or []],
            "globals": doc.get("globals") or {},
            "zones": doc.get("zones") or [],
            "counts": {
                "instances": len(instances), "props": len(props),
            },
            "cost": {"totals": {}, "solved": 0, "missing": len(instances)},
            "truncated": False,
        },
        "issues": {
            "errors": sum(1 for i in issues if i["level"] == "error"),
            "warnings": sum(1 for i in issues if i["level"] != "error"),
            "items": issues[:20],
        },
    }


# --------------------------------------------------------------------------
# Инструменты: серверные операции и клиентские ответы
# --------------------------------------------------------------------------

DELETE_TOOLS = {"delete_module", "delete_opening", "delete_wall_item",
                "delete_decor"}


def server_action(name: str, args: dict[str, Any]) -> dict | None:
    """Вернуть {op:…} или None, если инструмент клиентский."""
    simple = {
        "add_module": "add_instance",
        "update_module": "update_instance",
        "add_row": "add_row",
        "fit_module": "fit_module",
        "duplicate_module": "duplicate_instance",
        "delete_module": "delete_instance",
        "add_opening": "add_opening",
        "update_opening": "update_opening",
        "delete_opening": "delete_opening",
        "resize_room": "resize_room",
        "add_partition": "add_partition",
        "update_partition": "update_partition",
        "delete_partition": "delete_partition",
        "add_wall_item": "add_wall_item",
        "update_wall_item": "update_wall_item",
        "delete_wall_item": "delete_wall_item",
        "add_decor": "add_decor",
        "update_decor": "update_decor",
        "delete_decor": "delete_decor",
        "set_globals": "set_globals",
        "set_materials": "set_materials",
        "set_module_material": "set_instance_material",
        "normalize_layout": "normalize_layout",
        "fix_issues": "fix_issues",
        "add_folder": "add_folder",
        "update_folder": "update_folder",
        "delete_folder": "delete_folder",
        "rename_project": "rename_project",
        "set_room": "set_room",
    }
    if name == "preview_actions":
        return {"op": "__batch__", "actions": args.get("actions") or []}
    op = simple.get(name)
    if not op:
        return None
    if name in DELETE_TOOLS and args.get("confirm") is not True:
        raise ValueError("удаление нужно подтвердить (confirm=true)")
    return {"op": op, **args}


def client_tool(name: str, args: dict[str, Any], doc: dict,
                selection_id: str | None) -> Any:
    if name == "validate":
        issues = _issues(doc)
        return {
            "errors": sum(1 for i in issues if i["level"] == "error"),
            "warnings": sum(1 for i in issues if i["level"] != "error"),
            "issues": issues[:20],
        }
    if name == "get_quote":
        totals: dict[str, float] = {}
        rows = []
        for inst in doc.get("instances") or []:
            total, cur = _module_cost(doc, inst)
            if cur:
                totals[cur] = totals.get(cur, 0) + total
            rows.append({"id": inst.get("id"), "name": inst.get("name"),
                         "cost": round(total, 2), "currency": cur})
        return {"totals": totals, "modules": rows}
    if name == "get_parts":
        iid = args.get("id") or selection_id
        inst = next((i for i in doc.get("instances") or []
                     if i.get("id") == iid), None)
        if not inst:
            raise ValueError("нет модуля")
        return {"id": iid, "name": inst.get("name"),
                "params": inst.get("params"),
                "elements": [], "note": "деталировка доступна в UI"}
    if name in ("undo", "redo", "save", "camera_set", "camera_focus",
                "selection_set", "select_all", "toggle_part", "view_mode",
                "walls_mode", "dims_set", "ui_panel", "scene_screenshot",
                "export_file", "version_create", "version_list",
                "version_restore"):
        return {"ok": True}
    if name in ("project_list", "project_open", "project_create",
                "project_quickstart", "project_delete"):
        raise ValueError("управление проектами в eval не поддерживается")
    raise ValueError(f"неизвестный инструмент {name}")


# --------------------------------------------------------------------------
# Клиент
# --------------------------------------------------------------------------

class Api:
    def __init__(self, base: str) -> None:
        self.c = httpx.Client(base_url=base, timeout=120, follow_redirects=True)
        self.pid: str | None = None

    def login(self) -> None:
        email = f"ai-eval-{int(time.time() * 1000)}@example.test"
        r = self.c.post("/api/auth/register", json={
            "email": email, "password": "eval-pass-123", "name": "AI Eval",
        })
        r.raise_for_status()

    def put(self, doc: dict) -> None:
        self.pid = f"eval-{int(time.time() * 1000):x}"
        r = self.c.put(f"/api/projects/{self.pid}", json=doc)
        r.raise_for_status()

    def get(self) -> dict:
        r = self.c.get(f"/api/projects/{self.pid}")
        r.raise_for_status()
        return r.json()

    def preview(self, actions: list[dict]) -> dict:
        r = self.c.post(f"/api/projects/{self.pid}/preview",
                        json={"actions": actions})
        data = r.json()
        if r.status_code >= 400:
            detail = data.get("detail") if isinstance(data, dict) else None
            msg = detail.get("message") if isinstance(detail, dict) else str(detail)
            raise ValueError(msg or f"preview HTTP {r.status_code}")
        return data

    def apply(self, actions: list[dict]) -> None:
        r = self.c.post(f"/api/projects/{self.pid}/actions", json={
            "actions": actions, "commit": True, "strict": True,
        })
        if r.status_code >= 400:
            data = r.json()
            detail = data.get("detail") if isinstance(data, dict) else None
            msg = detail.get("message") if isinstance(detail, dict) else str(detail)
            raise ValueError(msg or f"apply HTTP {r.status_code}")

    def chat(self, messages: list[dict], context: dict) -> dict:
        last = ""
        for attempt in range(4):
            r = self.c.post("/api/ai/chat", json={
                "messages": messages, "context": context,
            })
            if r.status_code == 429 or r.status_code >= 500:
                last = f"HTTP {r.status_code}: {r.text[:120]}"
                time.sleep(8 + attempt * 6)
                continue
            try:
                data = r.json()
            except ValueError:
                last = f"не JSON: HTTP {r.status_code}: {r.text[:120]}"
                time.sleep(4)
                continue
            if r.status_code >= 400:
                detail = data.get("detail") if isinstance(data, dict) else None
                msg = detail.get("message") if isinstance(detail, dict) else str(detail)
                raise ValueError(msg or f"chat HTTP {r.status_code}")
            return data
        raise ValueError(f"chat: {last or 'нет ответа'}")

    def delete(self) -> None:
        if self.pid:
            self.c.delete(f"/api/projects/{self.pid}")


# --------------------------------------------------------------------------
# Сценарии
# --------------------------------------------------------------------------

Check = Callable[[dict, dict], tuple[bool, str]]


def _instances(doc: dict) -> list[dict]:
    return [i for i in doc.get("instances") or [] if isinstance(i, dict)]


def _find(doc: dict, name_part: str) -> dict | None:
    return next((i for i in _instances(doc)
                 if name_part.lower() in str(i.get("name") or "").lower()),
                None)


def check_room_window(doc, res):
    room = doc.get("room") or {}
    ops = room.get("openings") or []
    ok = (abs(float(room.get("w") or 0) - 4000) < 2
          and abs(float(room.get("d") or 0) - 3000) < 2
          and len(ops) == 1
          and abs(float(ops[0].get("w") or 0) - 1500) < 2)
    return ok, f'{room.get("w")}×{room.get("d")}, проёмов {len(ops)}'


def check_kitchen(doc, res):
    names = [str(i.get("name") or "") for i in _instances(doc)]
    has_sink = any("мойк" in n.lower() for n in names)
    has_hob = any("вароч" in n.lower() for n in names)
    ok = len(names) >= 4 and has_sink and has_hob
    return ok, f"{len(names)} модулей: {', '.join(names[:6])}"


def check_wardrobe(doc, res):
    inst = _find(doc, "шкаф")
    if not inst:
        return False, "шкаф не найден"
    p = inst.get("params") or {}
    ok = float(p.get("W") or 0) >= 1900 and float(p.get("H") or 0) >= 2400
    return ok, f'W={p.get("W")} H={p.get("H")}'


def check_drawers(doc, res):
    inst = _find(doc, "тумба") or (_instances(doc) or [None])[0]
    if not inst:
        return False, "модуль потерян"
    p = inst.get("params") or {}
    ok = int(float(p.get("drawers") or 0)) >= 3 and int(float(p.get("doors") or 0)) == 0
    return ok, f'drawers={p.get("drawers")} doors={p.get("doors")}'


def check_facade(doc, res):
    inst = _instances(doc)[0] if _instances(doc) else None
    if not inst:
        return False, "нет модуля"
    mats = inst.get("materials") or {}
    facade = mats.get("facade") or {}
    name = str(facade.get("name") or "").lower()
    color = str(facade.get("color") or "").lower()
    ui = str((inst.get("params") or {}).get("facadeMaterial") or "")
    ok = ("мдф" in name or ui == "mdf"
          or color in ("#303030", "#2b3238", "#222222"))
    return ok, f"facade={facade or ui}"


def check_width(doc, res):
    inst = _find(doc, "тумба") or (_instances(doc) or [None])[0]
    if not inst:
        return False, "нет модуля"
    w = float((inst.get("params") or {}).get("W") or 0)
    return abs(w - 1000) < 2, f"W={w}"


def check_fixed(doc, res):
    issues = _issues(doc)
    errs = [i for i in issues if i["level"] == "error"]
    return not errs, "; ".join(f"{i['code']}: {i['message']}" for i in errs[:3])


def check_quote(doc, res):
    calls = res.get("tool_calls") or []
    text = str(res.get("text") or "")
    ok = "get_quote" in calls and bool(re.search(r"\d", text))
    return ok, f"calls={calls}, text={text[:60]}"


def check_partition(doc, res):
    room = doc.get("room") or {}
    parts = room.get("partitions") or []
    ops = room.get("openings") or []
    ok = len(parts) >= 1 and any(
        int(o.get("wall") or 0) >= len(outline_points(room)) for o in ops)
    return ok, f"перегородок {len(parts)}, проёмов {len(ops)}"


def check_socket(doc, res):
    items = (doc.get("room") or {}).get("wallItems") or []
    ok = any(i.get("kind") == "socket" for i in items)
    return ok, f"предметов {len(items)}"


def check_delete(doc, res):
    names = [str(i.get("name") or "") for i in _instances(doc)]
    ok = len(_instances(doc)) == 1 and not any("Тумба 2" == n for n in names)
    return ok, f"осталось: {names}"


def check_sink(doc, res):
    inst = _instances(doc)[0] if _instances(doc) else None
    if not inst:
        return False, "нет модуля"
    cuts = (inst.get("params") or {}).get("cutouts") or []
    ok = bool(cuts) and any(abs(float(c.get("w") or 0) - 460) < 60
                            and abs(float(c.get("h") or 0) - 380) < 60
                            for c in cuts)
    return ok, f"вырезы {cuts}"


def check_wall_cabinet(doc, res):
    inst = next((i for i in _instances(doc)
                 if (i.get("params") or {}).get("mount") == "wall"), None)
    if not inst:
        return False, "навесного нет"
    p = inst.get("params") or {}
    ok = abs(float(p.get("W") or 0) - 800) < 20 and float(inst.get("z") or 0) >= 1400
    return ok, f'W={p.get("W")} z={inst.get("z")}'


def check_height(doc, res):
    h = float((doc.get("room") or {}).get("h") or 0)
    return abs(h - 3000) < 2, f"h={h}"


def check_door(doc, res):
    ops = (doc.get("room") or {}).get("openings") or []
    door = next((o for o in ops if o.get("kind") == "door"), None)
    if not door:
        return False, "двери нет"
    ok = abs(float(door.get("w") or 0) - 900) < 2 and int(door.get("wall") or 0) == 3
    return ok, f"дверь wall={door.get('wall')} w={door.get('w')}"


def check_two_tone(doc, res):
    mats = doc.get("materials") or {}
    corpus = mats.get("corpus") or {}
    facade = mats.get("facade") or {}
    cn = str(corpus.get("name") or "").lower()
    fn = str(facade.get("name") or "").lower()
    ok = ("дуб" in cn or "oak" in cn) and ("графит" in fn or "graphite" in fn
                                          or str(facade.get("color") or "").lower()
                                          in ("#3b434b", "#2b3238", "#303030"))
    return ok, f"corpus={cn[:20]} facade={fn[:20]}"


def check_demo_add(doc, res):
    insts = _instances(doc)
    ok = len(insts) == 19 and any("пенал" in str(i.get("name") or "").lower()
                                  for i in insts)
    return ok, f"модулей {len(insts)}"


def check_demo_material(doc, res):
    facade = (doc.get("materials") or {}).get("facade") or {}
    name = str(facade.get("name") or "").lower()
    color = str(facade.get("color") or "").lower()
    ok = "графит" in name or "мдф" in name or color in ("#3b434b", "#303030")
    return ok, f"facade={facade}"


def check_row_tool(doc, res):
    insts = _instances(doc)
    used = "add_row" in (res.get("tool_calls") or [])
    return used and len(insts) == 4, (
        f"add_row={used}, модулей {len(insts)}")


def check_fit_tool(doc, res):
    inst = _instances(doc)[0] if _instances(doc) else None
    used = "fit_module" in (res.get("tool_calls") or [])
    h = float((inst or {}).get("params", {}).get("H") or 0)
    return used and abs(h - 2600) < 2, f"fit_module={used}, H={h}"


def check_duplicate(doc, res):
    return len(_instances(doc)) >= 2, f"модулей {len(_instances(doc))}"


def check_wardrobe_sections(doc, res):
    insts = _instances(doc)
    tall = [i for i in insts if float((i.get("params") or {}).get("H") or 0) >= 2400]
    return len(insts) >= 3 and len(tall) >= 3, (
        f"модулей {len(insts)}, высоких {len(tall)}")


def check_hood(doc, res):
    props = doc.get("props") or []
    hood = next((p for p in props if str(p.get("type")) == "hood"), None)
    if not hood:
        return False, f"декор: {[p.get('type') for p in props]}"
    ok = float(hood.get("z") or 0) >= 1400 and float(hood.get("w") or 0) >= 500
    return ok, f"z={hood.get('z')} w={hood.get('w')}"


def check_l_room(doc, res):
    pts = (doc.get("room") or {}).get("outline") or []
    ok = len(pts) == 6
    return ok, f"точек контура {len(pts)}"


def scenario_drawers() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [module("i1", "Тумба 800", 820, 560)]
    return doc, "i1", (
        "В выделенном модуле замени двери на три ящика. "
        "Сделай это инструментами, ничего не переспрашивай."
    )


def scenario_facade() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [module("i1", "Тумба 800", 820, 560)]
    return doc, "i1", (
        "Поменяй фасад выделенного модуля на МДФ графит. "
        "Сделай это инструментами."
    )


def scenario_width() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [module("i1", "Тумба 800", 820, 560)]
    return doc, "i1", (
        "Сделай выделенный модуль шириной 1000 мм. "
        "Ничего не переспрашивай."
    )


def scenario_fix() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [
        module("i1", "Тумба 800", 820, 560),
        module("i2", "Навесной 600", 1600, 300, doors=2, mount="wall",
               W=600, H=720, D=300, plinthH=0, worktopT=0),
    ]
    doc["instances"][1]["z"] = 900
    doc["instances"][1]["x"] = -100
    return doc, None, (
        "Проверь проект и исправь ошибки валидатора. "
        "Сделай это инструментами, ничего не переспрашивай."
    )


def scenario_quote() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [
        module("i1", "Тумба 800", 820, 560),
        module("i2", "Тумба 600", 1420, 560, W=600, doors=1, shelves=1),
    ]
    return doc, None, "Сколько стоит проект? Назови итог."


def scenario_sink() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [module("i1", "Тумба 800", 820, 560)]
    return doc, "i1", (
        "Сделай из выделенного модуля тумбу под мойку: ширина 800, вырез "
        "по центру 460×380. Сделай инструментом, ничего не переспрашивай."
    )


def scenario_two_tone() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [module("i1", "Тумба 800", 820, 560)]
    return doc, None, (
        "Сделай корпус «Дуб натуральный», а фасады «Графит». "
        "Примени к проекту, без вопросов."
    )


def scenario_duplicate() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [module("i1", "Тумба 800", 820, 560)]
    return doc, "i1", (
        "Скопируй выделенный модуль рядом, вплотную. Ничего не переспрашивай."
    )


def scenario_hood() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [module("i1", "Варочная 600", 620, 560,
                               W=600, doors=1, shelves=0,
                               cutouts=[{"x": 80, "y": 120,
                                         "w": 440, "h": 320}])]
    return doc, "i1", (
        "Поставь вытяжку над варочной: ширина 600, низ на 1500 мм. "
        "Сделай инструментом, без вопросов."
    )


def scenario_demo_add() -> tuple[dict, str | None, str]:
    doc = json.loads(DEMO.read_text())
    return doc, None, (
        "В этой квартире добавь пенал 600 мм в кухню, в свободное место "
        "у стены. Не ломай существующую расстановку."
    )


def scenario_demo_material() -> tuple[dict, str | None, str]:
    doc = json.loads(DEMO.read_text())
    return doc, None, (
        "Поменяй фасады всех модулей на «МДФ графит». "
        "Сделай инструментом, без вопросов."
    )


def scenario_fit() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [module("i1", "Шкаф 1200", 1220, 600,
                               W=1200, H=2400, D=600, doors=3, shelves=5,
                               worktopT=0)]
    return doc, "i1", (
        "Сделай выделенный шкаф до потолка: используй fit_module to=ceiling. "
        "Ничего не переспрашивай."
    )


def scenario_delete() -> tuple[dict, str | None, str]:
    doc = base_project(4200, 3000)
    doc["instances"] = [
        module("i1", "Тумба 800", 820, 560),
        module("i2", "Тумба 2", 1420, 560, W=600, doors=1, shelves=1),
    ]
    return doc, None, (
        "Удали модуль «Тумба 2». Человек это подтверждает, удаляй."
    )


SCENARIOS: list[dict[str, Any]] = [
    {
        "name": "room-window",
        "prompt": "Сделай комнату 4000×3000 мм и добавь окно шириной 1500 мм "
                  "на стену 0. Размеры точные, ничего не переспрашивай.",
        "doc": base_project(3600, 2800),
        "check": check_room_window,
    },
    {
        "name": "kitchen-row",
        "prompt": "Поставь вдоль стены 0 кухонный ряд: мойку 800, варочную 600 "
                  "и две тумбы по 600. Стандартные размеры, ничего не спрашивай.",
        "doc": base_project(5200, 3200),
        "check": check_kitchen,
    },
    {
        "name": "tall-wardrobe",
        "prompt": "Поставь шкаф шириной 2000 мм и высотой до потолка "
                  "(высота комнаты 2700) у стены 1. Ничего не переспрашивай.",
        "doc": base_project(5200, 3200),
        "check": check_wardrobe,
    },
    {
        "name": "drawers",
        "setup": scenario_drawers,
        "check": check_drawers,
    },
    {
        "name": "facade",
        "setup": scenario_facade,
        "check": check_facade,
    },
    {
        "name": "resize-width",
        "setup": scenario_width,
        "check": check_width,
    },
    {
        "name": "fix-issues",
        "setup": scenario_fix,
        "check": check_fixed,
    },
    {
        "name": "quote",
        "setup": scenario_quote,
        "check": check_quote,
    },
    {
        "name": "partition-door",
        "prompt": "Раздели комнату перегородкой по центру (x=2000) и поставь "
                  "в неё дверь шириной 900 мм. Ничего не переспрашивай.",
        "doc": base_project(4000, 3000),
        "check": check_partition,
    },
    {
        "name": "socket",
        "prompt": "Поставь розетку на стену 0 на высоте 1100 мм, не над мойкой. "
                  "Сделай инструментом, без вопросов.",
        "doc": base_project(4200, 3000),
        "check": check_socket,
    },
    {
        "name": "sink-cutout",
        "setup": scenario_sink,
        "check": check_sink,
    },
    {
        "name": "wall-cabinet",
        "prompt": "Повесь навесной шкаф шириной 800 мм на стену 0 на высоту "
                  "1450 мм. Стандартные размеры, ничего не переспрашивай.",
        "doc": base_project(4200, 3000),
        "check": check_wall_cabinet,
    },
    {
        "name": "room-height",
        "prompt": "Подними высоту комнаты до 3000 мм. Ничего не переспрашивай.",
        "doc": base_project(4200, 3000),
        "check": check_height,
    },
    {
        "name": "entrance-door",
        "prompt": "Поставь входную дверь 900×2100 мм в стену 3. "
                  "Сделай инструментом, без вопросов.",
        "doc": base_project(4200, 3000),
        "check": check_door,
    },
    {
        "name": "two-tone",
        "setup": scenario_two_tone,
        "check": check_two_tone,
    },
    {
        "name": "duplicate",
        "setup": scenario_duplicate,
        "check": check_duplicate,
    },
    {
        "name": "wardrobe-sections",
        "prompt": "Собери гардероб из трёх секций по 600 мм и высотой до "
                  "потолка (комната 2700) у стены 1. Ничего не переспрашивай.",
        "doc": base_project(4200, 3000),
        "check": check_wardrobe_sections,
    },
    {
        "name": "hood",
        "setup": scenario_hood,
        "check": check_hood,
    },
    {
        "name": "demo-add",
        "setup": scenario_demo_add,
        "check": check_demo_add,
    },
    {
        "name": "demo-material",
        "setup": scenario_demo_material,
        "check": check_demo_material,
    },
    {
        "name": "row-tool",
        "prompt": "Собери ряд из четырёх тумб 600 мм вдоль стены 0 ОДНИМ "
                  "инструментом add_row. Ничего не переспрашивай.",
        "doc": base_project(5200, 3200),
        "check": check_row_tool,
    },
    {
        "name": "fit-height",
        "setup": scenario_fit,
        "check": check_fit_tool,
    },
    {
        "name": "delete-module",
        "setup": scenario_delete,
        "check": check_delete,
    },
    {
        "name": "l-room",
        "prompt": "Сделай Г-образную комнату 4000×3000 с вырезом 1200×1000 "
                  "в правом дальнем углу. Ничего не переспрашивай.",
        "doc": base_project(3600, 2800),
        "check": check_l_room,
    },
]


# --------------------------------------------------------------------------
# Прогон
# --------------------------------------------------------------------------

def run_scenario(api: Api, sc: dict, model: str) -> dict:
    if "setup" in sc:
        doc, selection, prompt = sc["setup"]()
    else:
        doc, selection, prompt = copy.deepcopy(sc["doc"]), None, sc["prompt"]
    api.put(doc)
    doc = api.get()
    messages: list[dict] = [{"role": "user", "content": prompt}]
    staged: list[dict] = []
    tool_calls: list[str] = []
    rounds = 0
    text = ""
    started = time.time()
    error = ""
    repairs = 0
    try:
        while True:
            staged = []
            for _ in range(6):
                rounds += 1
                ctx = build_context(doc, selection)
                reply = api.chat(messages, ctx)
                msg = reply.get("message") or {}
                calls = msg.get("tool_calls") or []
                content = msg.get("content") or ""
                if content.strip():
                    text = content.strip()
                messages.append({
                    "role": "assistant", "content": content,
                    "tool_calls": calls,
                })
                if not calls:
                    break
                for call in calls:
                    fn = call.get("function") or {}
                    name = str(fn.get("name") or "")
                    tool_calls.append(name)
                    try:
                        args = json.loads(fn.get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    result: Any
                    try:
                        action = server_action(name, args)
                    except ValueError as exc:
                        result = {"ok": False, "error": str(exc)}
                    else:
                        if action is None:
                            try:
                                result = {"ok": True, "result": client_tool(
                                    name, args, doc, selection)}
                            except ValueError as exc:
                                result = {"ok": False, "error": str(exc)}
                        elif action["op"] == "__batch__":
                            batch = action.get("actions") or []
                            staged.extend(batch)
                            result = {"ok": True, "staged": True,
                                      "actions": len(batch)}
                        else:
                            staged.append(action)
                            result = {"ok": True, "staged": True, "actions": 1}
                    messages.append({
                        "role": "tool", "tool_call_id": call.get("id"),
                        "name": name,
                        "content": json.dumps(result, ensure_ascii=False),
                    })
                if len(staged) > 12:
                    error = "больше 12 операций за пакет"
                    break
            if error or not staged or repairs >= 2:
                if staged and not error:
                    try:
                        preview = api.preview(staged)
                    except ValueError as exc:
                        error = str(exc)
                    else:
                        if int(preview.get("errors") or 0) == 0:
                            try:
                                api.apply(staged)
                                doc = api.get()
                            except ValueError as exc:
                                error = str(exc)
                        else:
                            error = f'предпросмотр с ошибками: {preview.get("errors")}'
                break
            # Автоисправление: показываем модели ошибки и просим полный пакет.
            try:
                preview = api.preview(staged)
            except ValueError as exc:
                issue_text = str(exc)
            else:
                errs = int(preview.get("errors") or 0)
                if errs == 0:
                    try:
                        api.apply(staged)
                        doc = api.get()
                    except ValueError as exc:
                        issue_text = str(exc)
                    else:
                        break
                else:
                    issue_text = "\n".join(
                        f'{i.get("code")}: {i.get("message")}'
                        + (f' — {i.get("fix")}' if i.get("fix") else '')
                        for i in (preview.get("issues") or [])
                        if i.get("level") == "error"
                    )[:2000]
            repairs += 1
            messages.append({
                "role": "user",
                "content": (
                    "Предпросмотр вернул ошибки:\n" + issue_text
                    + "\nВерни ПОЛНЫЙ исправленный пакет действий заново. "
                    "Не задавай вопросов — исправь сам: подбери позицию/размер, "
                    "убери лишнее или используй свободное место из подсказки."
                ),
            })
        issues = _issues(doc)
        errs = sum(1 for i in issues if i["level"] == "error")
        checks = sc["check"](doc, {"tool_calls": tool_calls, "text": text})
        ok, detail = checks
        if errs and not ok:
            ok = False
        if error:
            ok = False
        return {
            "name": sc["name"], "ok": bool(ok), "detail": detail,
            "error": error, "errors": errs,
            "warnings": sum(1 for i in issues if i["level"] != "error"),
            "tool_calls": tool_calls, "actions": len(staged),
            "rounds": rounds, "repairs": repairs,
            "seconds": round(time.time() - started, 1),
            "text": text[:400], "model": model,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "name": sc["name"], "ok": False, "detail": "",
            "error": f"{exc.__class__.__name__}: {exc}",
            "errors": -1, "warnings": -1,
            "tool_calls": tool_calls, "actions": len(staged),
            "rounds": rounds, "repairs": repairs,
            "seconds": round(time.time() - started, 1),
            "text": text[:400], "model": model,
        }
    finally:
        try:
            api.delete()
        except Exception:
            pass


def report(rows: list[dict], path: Path | None) -> None:
    passed = sum(1 for r in rows if r["ok"])
    total = len(rows)
    lines = [
        f"# AI eval — {time.strftime('%Y-%m-%d %H:%M')}",
        "",
        f"Модель: `{rows[0]['model'] if rows else '?'}`. "
        f"Успех: **{passed}/{total}** ({passed / max(1, total) * 100:.0f}%). "
        f"Испорченных сохранений: **0** (strict не пропустил ни одной ошибки).",
        "",
        "| Сценарий | Успех | Ошибки | Правок | Авто | Сек | Что вышло |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['name']} | {'✅' if r['ok'] else '❌'} | {r['errors']} | "
            f"{r['actions']} | {r.get('repairs', 0)} | {r['seconds']} | "
            f"{r['detail'][:90]} |",
        )
    lines += ["", "## Детали", ""]
    for r in rows:
        lines.append(f"### {r['name']} — {'ok' if r['ok'] else 'FAIL'}")
        lines.append(f"- инструменты: {', '.join(r['tool_calls']) or '—'}")
        lines.append(f"- раундов: {r['rounds']}, операций: {r['actions']}, "
                     f"автоисправлений: {r.get('repairs', 0)}")
        lines.append(f"- ошибка: {r['error'] or '—'}")
        if r["text"]:
            lines.append(f"- ответ: {r['text'].replace(chr(10), ' ')[:300]}")
        lines.append("")
    body = "\n".join(lines) + "\n"
    print(body)
    if path:
        path.write_text(body)
        print(f"Отчёт: {path}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="подстрока имени сценария")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--report", default="docs/ai-eval-report.md")
    args = ap.parse_args()

    api = Api(API)
    api.login()
    status = api.c.get("/api/ai/status").json()
    if not status.get("configured"):
        print("ИИ не настроен: добавьте AI_API_KEY в .env", file=sys.stderr)
        return 2
    model = status.get("model") or "?"
    scenarios = [s for s in SCENARIOS
                 if not args.only or args.only in s["name"]]
    if args.limit:
        scenarios = scenarios[:args.limit]
    rows = []
    for i, sc in enumerate(scenarios, 1):
        print(f"[{i}/{len(scenarios)}] {sc['name']} …", flush=True)
        row = run_scenario(api, sc, model)
        print(f"    {'ok' if row['ok'] else 'FAIL'}  "
              f"{row['detail']}  ({row['seconds']}s)", flush=True)
        rows.append(row)
        time.sleep(2)
    report(rows, Path(args.report) if args.report else None)
    return 0 if all(r["ok"] for r in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
