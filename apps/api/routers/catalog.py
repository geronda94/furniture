"""Справочники: health, каталог, материалы, цех, фурнитура, цены, гайд."""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException

from ..actions import DEFAULT_PARAMS, MODULE_PRESETS
from ..common import MATERIALS, ROOT, SCHEMA, SHOP
from ..storage import using_db
from furniture_core import load_config
from furniture_core.hardware import (
    load_edge_types,
    load_fasteners,
    load_gas_struts,
    load_handles,
    load_hinges,
    load_legs,
    load_runners,
    load_shelf_supports,
)
from furniture_core.pricing import load_options as load_pricing_options
from furniture_core.pricing import load_pricing

router = APIRouter()

@router.get("/api/health")
def health():
    return {
        "ok": True, "schema": SCHEMA, "engine": "furniture_core",
        "storage": "postgres" if using_db() else "files",
    }


@router.get("/api/catalog")
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


@router.get("/api/materials")
def materials_catalog() -> dict[str, Any]:
    if not MATERIALS.exists():
        return {"categories": []}
    try:
        import yaml
        return yaml.safe_load(MATERIALS.read_text(encoding="utf-8")) or {"categories": []}
    except Exception:
        return {"categories": []}


@router.get("/api/shop")
def shop_config(shop: str | None = None):
    path = ROOT / "specs" / shop if shop else SHOP
    if not path.exists():
        raise HTTPException(404, f"нет профиля цеха: {path.name}")
    return {"shop": path.stem, "config": asdict(load_config(path))}


@router.get("/api/hardware")
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


@router.get("/api/pricing/options")
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


@router.get("/api/ai/tools")
def ai_tools():
    """JSON Schema инструментов для ИИ-чата/агента."""
    from ..ai_tools import tools_payload
    return tools_payload()


@router.get("/api/ai/guide")
def ai_guide():
    """Короткая инструкция для ИИ-агента: что можно и как."""
    return {
        "schema": SCHEMA,
        "endpoints": {
            "GET /api/catalog": "пресеты, толщины, материалы корпуса, правила",
            "GET /api/ai/tools": "JSON Schema инструментов и правила для ИИ",
            "GET /api/shop": "профиль цеха (плита, кромки, лист, зазоры)",
            "GET /api/hardware": "фурнитура, крепёж, полкодержатели, кромка",
            "GET /api/pricing/options": "рынки, цеха, поставщики, активный прайс",
            "POST /api/solve": "деталировка + 3D + BOM + раскрой",
            "POST /api/validate": "проверка без выдачи полного результата",
            "GET /api/projects": "список проектов",
            "GET /api/projects/{id}": "проект целиком",
            "PUT /api/projects/{id}?strict=1": "заменить проект и отклонить при ошибках",
            "POST /api/projects/{id}/actions": "пакет правок; commit=false — предпросмотр; strict=true — не сохранять с ошибками",
            "GET /api/projects/{id}/layout": "полная проверка: стены, проёмы, мебель, декор, цоколь, двери, зазоры",
            "POST /api/projects/{id}/layout/normalize": "прижать к стенам, уплотнить ряд, развернуть фасады",
            "GET /api/projects/{id}/summary": "сводка проекта для ИИ",
            "GET /api/ai/tools": "полный каталог инструментов ИИ-чата (JSON Schema)",
            "GET /api/projects/{id}/versions": "снимки проекта",
            "POST /api/projects/{id}/versions": "сделать снимок",
            "POST /api/projects/{id}/versions/{vid}/restore": "откатить к снимку",
        },
        "actions": [
            "add_instance {preset?, params?, x?, y?, z?, rot?, name?}",
            "update_instance {id, params?, x?, y?, z?, rot?, name?}",
            "duplicate_instance {id, name?}",
            "delete_instance {id}",
            "resize_room {w?, d?, h?, wallT?, shape?, cutW?, cutD?, outline?}",
            "set_room {patch} — поверхности/настройки, не геометрия",
            "add_partition {a?, b?, wallT?}",
            "update_partition {index, patch}",
            "delete_partition {index}",
            "add_opening {kind, wall, x?, w?, z0?, z1?, hinge?, angle?}",
            "update_opening {id, patch}",
            "delete_opening {id}",
            "add_wall_item {kind, wall, x?, z?, w?, h?, depth?}",
            "update_wall_item {id, patch}",
            "delete_wall_item {id}",
            "add_decor {type, name?, x?, y?, z?, rot?, w?, d?, h?, color?}",
            "update_decor {id, patch}",
            "delete_decor {id}",
            "set_materials {materials}",
            "set_instance_material {id, role, patch}",
            "set_globals {patch}",
            "add_folder {name, ids?}",
            "update_folder {id, name?, ids?}",
            "delete_folder {id}",
            "rename_project {name}",
            "normalize_layout {close_gaps?, fix_decor?}",
            "fix_issues {issues: [{code, instance}], normalize?}",
            "preview_actions {actions}",
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
            "Напольные/навесные модули ставить задней стенкой к внутренней грани стены, фасадом в комнату.",
            "Не перекрывать двери и окна; перед дверью — не менее 420 мм и не меньше ширины полотна.",
            "Модули одного ряда ставить вплотную: зазор между корпусами 0 мм; 2–3 мм — только зазор фасадов.",
            "Не врезать корпус в толщу стены и не задевать декор: проверять через GET /layout.",
            "Цоколь: 0 <= plinthH < H; фактическая высота = plinthH + H + worktopT. Цоколь не может быть выше корпуса или уходить под пол.",
            "Непрерывные кухни/гардеробы: корпуса в ряду строго вплотную, зазор 0 мм (2–3 мм только между фасадами).",
            "Двери фасадов при открывании не должны задевать стены, проёмы, соседнюю мебель и декор.",
            "Декор (растения, ТВ, сантехника) — такие же твёрдые объекты: проверяются на стены, проёмы, мебель и друг друга.",
            "Перед выдачей проекта обязательно: GET /layout; errors=0; иначе исправить и повторить. PUT с ?strict=1 не сохранит проект с ошибками.",
            "Необратимые действия — только с подтверждением человека.",
        ],
    }


