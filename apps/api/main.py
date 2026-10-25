"""Локальный API конструктора: solve + файловые проекты.

Запуск из корня репозитория:
    uvicorn apps.api.main:app --reload --port 8000

Без БД, очередей и авторизации — этап локальной разработки.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dataclasses import asdict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
PROJECTS = ROOT / "projects"
SHOP = ROOT / "specs" / "shop-default.yaml"
MATERIALS = ROOT / "specs" / "materials.yaml"

if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from furniture_core import load_config, solve  # noqa: E402
from furniture_core.hardware import (  # noqa: E402
    load_edge_types,
    load_fasteners,
    load_gas_struts,
    load_handles,
    load_hinges,
    load_legs,
    load_runners,
    load_shelf_supports,
)
from furniture_core.pricing import (  # noqa: E402
    load_options as load_pricing_options,
    load_pricing,
)
from .storage import (  # noqa: E402
    delete_project as repo_delete,
    delete_version as repo_delete_version,
    get_project as repo_get,
    get_version as repo_get_version,
    list_projects as repo_list,
    list_versions as repo_list_versions,
    put_project as repo_put,
    put_version as repo_put_version,
    using_db,
)

SCHEMA = "furniture/project@0"

app = FastAPI(title="Furniture Constructor API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SolveIn(BaseModel):
    product: dict[str, Any]
    shop: str | None = None
    market: str | None = None
    supplier: str | None = None


class ActionIn(BaseModel):
    actions: list[dict[str, Any]]
    commit: bool = False


class VersionIn(BaseModel):
    name: str | None = None


class RestoreIn(BaseModel):
    backup: bool = True


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


def _new_id(prefix: str) -> str:
    import random
    import time
    return f"{prefix}{int(time.time() * 1000):x}{random.randint(0, 999)}"


def _apply_action(doc: dict, act: dict) -> dict:
    op = act.get("op")
    if op == "add_instance":
        preset = next((p for p in MODULE_PRESETS
                       if p["key"] == act.get("preset")), MODULE_PRESETS[0])
        globals_ = {k: v for k, v in (doc.get("globals") or {}).items()
                    if k != "autoApply"}
        params = {**DEFAULT_PARAMS, **globals_,
                  **preset["params"], **(act.get("params") or {})}
        inst = {
            "id": _new_id("i"), "product": "base-cabinet",
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
            "id": _new_id("o"), "kind": kind, "wall": wall,
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


@app.get("/api/health")
def health():
    return {
        "ok": True, "schema": SCHEMA, "engine": "furniture_core",
        "storage": "postgres" if using_db() else "files",
    }


@app.get("/api/catalog")
def catalog():
    """Каталог для UI и ИИ: пресеты, материалы корпуса, толщины."""
    return {
        "module_presets": MODULE_PRESETS,
        "default_params": DEFAULT_PARAMS,
        "board_thickness": [10, 16, 18, 22],
        "backs": ["dvp", "same", "cardboard", "none"],
        "reinforce": ["auto", "on", "off"],
        "rules": {
            "units": "mm",
            "coordinates": "X длина, Y глубина (0=фасад), Z вверх",
            "inset_part": "вкладная деталь = габарит − 2t",
            "door_max_w": 600,
            "drawer_front_max_w": 900,
        },
    }


@app.get("/api/materials")
def materials_catalog() -> dict[str, Any]:
    if not MATERIALS.exists():
        return {"categories": []}
    try:
        import yaml
        return yaml.safe_load(MATERIALS.read_text(encoding="utf-8")) or {"categories": []}
    except Exception:
        return {"categories": []}


@app.get("/api/shop")
def shop_config(shop: str | None = None):
    path = ROOT / "specs" / shop if shop else SHOP
    if not path.exists():
        raise HTTPException(404, f"нет профиля цеха: {path.name}")
    return {"shop": path.stem, "config": asdict(load_config(path))}


@app.get("/api/hardware")
def hardware():
    """Каталог фурнитуры и крепежа из specs/hardware.yaml (для UI)."""
    path = ROOT / "specs" / "hardware.yaml"
    runners = load_runners(path)
    hinges = load_hinges(path)
    handles = load_handles(path)
    return {
        "drawer_runners": [r.as_dict() for r in runners],
        "hinges": [h.as_dict() for h in hinges],
        "handles": [h.as_dict() for h in handles],
        "fasteners": [f.as_dict() for f in load_fasteners(path)],
        "shelf_supports": [s.as_dict() for s in load_shelf_supports(path)],
        "gas_struts": [g.as_dict() for g in load_gas_struts(path)],
        "legs": [l.as_dict() for l in load_legs(path)],
        "edge_types": [e.as_dict() for e in load_edge_types()],
    }


@app.get("/api/pricing/options")
def pricing_options(
    market: str | None = None,
    shop: str | None = None,
    supplier: str | None = None,
):
    """Рынки, цеха, поставщики и активный прайс."""
    opts = load_pricing_options()
    pr = load_pricing(market=market, shop=shop, supplier=supplier)
    return {
        **opts,
        "active": pr.as_dict(),
        "price_lines": {
            "materials": pr.materials,
            "cutting": {
                "per_sheet": pr.cutting_per_sheet,
                "per_m2": pr.cutting_per_m2,
            },
            "edge": pr.edge,
            "hinge": pr.hinge,
            "runner_pair": pr.runner_pair,
            "assembly": {
                "module": pr.assembly_module,
                "door": pr.assembly_door,
                "drawer": pr.assembly_drawer,
            },
        },
    }


def _cfg_for_shop(shop_id: str | None):
    """Профиль цеха: файл specs/<id>.yaml или запись из shops.yaml.

    Старые проекты хранят shop-default (файл конфигурации), новые — id цеха
    из specs/shops.yaml. Для нового id берём лист/пропил из shops.yaml,
    остальное — базовый профиль.
    """
    if shop_id:
        path = ROOT / "specs" / f"{shop_id}.yaml"
        if path.exists():
            return load_config(path), path
    cfg = load_config(SHOP)
    if shop_id:
        for row in load_pricing_options().get("shops", []):
            if row.get("id") != shop_id:
                continue
            sheet = row.get("sheet") or {}
            cfg.sheet_w = float(sheet.get("w", cfg.sheet_w))
            cfg.sheet_h = float(sheet.get("h", cfg.sheet_h))
            cfg.trim = float(sheet.get("trim", cfg.trim))
            cfg.kerf = float(sheet.get("kerf", cfg.kerf))
            break
    return cfg, SHOP


@app.post("/api/solve")
def solve_endpoint(body: SolveIn):
    """Посчитать изделие. Возвращает локальную сцену, BOM и валидацию."""
    cfg, _ = _cfg_for_shop(body.shop)
    try:
        return solve(body.product, cfg, market=body.market,
                     shop=body.shop, supplier=body.supplier)
    except Exception as exc:  # движок должен отвечать понятной ошибкой
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/validate")
def validate_endpoint(body: SolveIn):
    """Только проверка: ошибки, предупреждения, габариты, состав."""
    cfg, _ = _cfg_for_shop(body.shop)
    try:
        res = solve(body.product, cfg, market=body.market,
                    shop=body.shop, supplier=body.supplier)
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "ok": not res["validation"]["errors"],
        "validation": res["validation"],
        "dims": res["dims"],
        "totals": res["totals"],
        "bom": res["bom"],
    }


@app.get("/api/ai/guide")
def ai_guide():
    """Короткая инструкция для ИИ-агента: что можно и как."""
    return {
        "schema": SCHEMA,
        "endpoints": {
            "GET /api/catalog": "пресеты, толщины, материалы корпуса, правила",
            "GET /api/shop": "профиль цеха (плита, кромки, лист, зазоры)",
            "GET /api/hardware": "фурнитура, крепёж, полкодержатели, кромка",
            "GET /api/pricing/options": "рынки, цеха, поставщики, активный прайс",
            "POST /api/solve": "деталировка + 3D + BOM + раскрой",
            "POST /api/validate": "проверка без выдачи полного результата",
            "GET /api/projects": "список проектов",
            "GET /api/projects/{id}": "проект целиком",
            "PUT /api/projects/{id}": "заменить проект целиком",
            "POST /api/projects/{id}/actions": "пакет правок; commit=false — предпросмотр",
            "GET /api/projects/{id}/summary": "сводка проекта для ИИ",
            "GET /api/projects/{id}/versions": "снимки проекта",
            "POST /api/projects/{id}/versions": "сделать снимок",
            "POST /api/projects/{id}/versions/{vid}/restore": "откатить к снимку",
        },
        "actions": [
            "add_instance {preset?, params?, x?, y?, z?, rot?, name?}",
            "update_instance {id, params?, x?, y?, z?, rot?, name?}",
            "delete_instance {id}",
            "add_opening {kind, wall, x?, w?, z0?, z1?}",
            "set_room {patch}",
            "set_globals {patch}",
        ],
        "params": {
            "fastener": "auto | confirmat | minifix | dowel | screw-4x30",
            "hiddenFasteners": "bool: авто-выбор минификса",
            "connectionOverrides": "{ carcass | divider | drawer: fastener_id }",
            "edges": "{ visible, hidden, byPart: { name: { side: auto|none|type } } }",
            "shelfSupport": "system32 | lock-pin | minifix-shelf | dowel-shelf",
            "gasStrut": "id из specs/hardware.yaml",
            "legMount": "id из specs/hardware.yaml.legs",
        },
        "rules": [
            "Размеры только из задания; не выдумывать.",
            "Кромка — по видимости торцов; правило можно переопределить params.edges.",
            "Крепёж — по docs/18-connections.md; не выдумывать id.",
            "Каждому дверному полотну — стойка.",
            "Каждая секция — независимый модуль со своей крышей.",
            "Необратимые действия — только с подтверждением человека.",
        ],
    }


@app.get("/api/projects")
def list_projects():
    try:
        return {"projects": repo_list()}
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    try:
        doc = repo_get(pid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if doc is None:
        raise HTTPException(404, "проект не найден")
    return doc


@app.get("/api/projects/{pid}/summary")
def project_summary(pid: str):
    doc = get_project(pid)
    room = doc.get("room", {})
    out = {
        "id": pid, "name": doc.get("name"), "schema": doc.get("schema"),
        "room": {k: room.get(k) for k in
                 ("w", "d", "h", "wallT", "outline", "partitions")},
        "globals": doc.get("globals", {}),
        "materialVars": doc.get("materialVars", []),
        "market": doc.get("market"),
        "shop": doc.get("shop"),
        "supplier": doc.get("supplier"),
        "openings": room.get("openings", []),
        "instances": [],
        "folders": doc.get("folders", []),
    }
    cfg, _ = _cfg_for_shop(doc.get("shop"))
    for inst in doc.get("instances", []):
        row = {k: inst.get(k) for k in
               ("id", "name", "x", "y", "z", "rot", "params")}
        try:
            globals_ = {k: v for k, v in (doc.get('globals') or {}).items()
                        if k != 'autoApply'}
            product = {**inst,
                       'params': {**globals_,
                                  **(inst.get('params') or {})}}
            res = solve(product, cfg, market=doc.get("market"),
                        shop=doc.get("shop"), supplier=doc.get("supplier"))
            row["dims"] = res["dims"]
            row["cost"] = res["cost"]
            row["validation"] = res["validation"]
            row["totals"] = res["totals"]
        except Exception as exc:
            row["validation"] = {"errors": [str(exc)], "warnings": []}
        out["instances"].append(row)
    return out


@app.post("/api/projects/{pid}/actions")
def project_actions(pid: str, body: ActionIn):
    doc = get_project(pid)
    results = []
    try:
        for act in body.actions:
            results.append(_apply_action(doc, act))
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    if body.commit:
        put_project(pid, doc)
    return {"ok": True, "committed": body.commit, "results": results,
            "project": doc if not body.commit else None}


@app.put("/api/projects/{pid}")
def put_project(pid: str, doc: dict[str, Any]):
    if not isinstance(doc, dict):
        raise HTTPException(400, "ожидается JSON-объект")
    try:
        path = repo_put(pid, doc)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "id": pid, "storage": path}


def _version_id() -> str:
    import random
    import time
    return f"v{int(time.time() * 1000):x}{random.randint(0, 999):03x}"


@app.get("/api/projects/{pid}/versions")
def list_versions(pid: str):
    if repo_get(pid) is None:
        raise HTTPException(404, "проект не найден")
    try:
        return {"versions": repo_list_versions(pid)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/projects/{pid}/versions")
def create_version(pid: str, body: VersionIn | None = None):
    doc = repo_get(pid)
    if doc is None:
        raise HTTPException(404, "проект не найден")
    name = (body.name if body else None) or "Снимок"
    vid = _version_id()
    try:
        return {"version": repo_put_version(pid, vid, doc, name)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/projects/{pid}/versions/{vid}")
def get_version(pid: str, vid: str):
    try:
        ver = repo_get_version(pid, vid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if ver is None:
        raise HTTPException(404, "версия не найдена")
    return ver


@app.post("/api/projects/{pid}/versions/{vid}/restore")
def restore_version(pid: str, vid: str, body: RestoreIn | None = None):
    try:
        ver = repo_get_version(pid, vid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if ver is None:
        raise HTTPException(404, "версия не найдена")
    doc = ver.get("doc")
    if not isinstance(doc, dict):
        raise HTTPException(422, "в версии нет документа проекта")
    if body is None or body.backup:
        current = repo_get(pid)
        if current is not None:
            repo_put_version(
                pid, _version_id(), current,
                f"Перед восстановлением: {ver.get('name') or vid}",
            )
    try:
        path = repo_put(pid, doc)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "restored": vid, "storage": path, "project": doc}


@app.delete("/api/projects/{pid}/versions/{vid}")
def delete_version(pid: str, vid: str):
    try:
        ok = repo_delete_version(pid, vid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not ok:
        raise HTTPException(404, "версия не найдена")
    return {"ok": True, "id": vid}


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    try:
        ok = repo_delete(pid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not ok:
        raise HTTPException(404, "проект не найден")
    return {"ok": True, "id": pid}
