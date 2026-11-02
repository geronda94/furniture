"""Проекты: CRUD, снимки, расстановка, preflight и strict-сохранение."""
from __future__ import annotations

import copy

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from .. import common
from ..actions import apply_action
from ..auth import public_user
from ..common import cfg_for_shop, project_for, user_or_401, version_id
from ..models import ActionIn, RestoreIn, VersionIn
from ..storage import (
    delete_project as repo_delete,
    delete_version as repo_delete_version,
    get_project as repo_get,
    get_version as repo_get_version,
    list_projects as repo_list,
    list_versions as repo_list_versions,
    put_project as repo_put,
    put_version as repo_put_version,
)
from furniture_core import solve
from furniture_core.cutting import pack as pack_sheets
from furniture_core.parts import Part
from furniture_core.layout import normalize_layout, validate_layout
from furniture_core.standards import validate_standards
from furniture_core.scene import normalize_scene, validate_scene

router = APIRouter()

@router.get("/api/projects")
def list_projects(request: Request):
    user = user_or_401(request)
    try:
        rows = repo_list(owner=user.get("id"), include_public=True)
        return {"projects": rows, "user": public_user(user)}
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@router.get("/api/projects/{pid}")
def get_project(pid: str, request: Request):
    project_for(request, pid)
    try:
        doc = repo_get(pid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if doc is None:
        raise HTTPException(404, "проект не найден")
    return doc


@router.get("/api/projects/{pid}/summary")
def project_summary(pid: str, request: Request):
    project_for(request, pid)
    doc = repo_get(pid)
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
    cfg, _ = cfg_for_shop(doc.get("shop"))
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


@router.post("/api/projects/{pid}/actions")
def project_actions(pid: str, body: ActionIn, request: Request):
    user = project_for(request, pid)
    doc = repo_get(pid)
    results = []
    try:
        for act in body.actions:
            results.append(apply_action(doc, act))
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    if body.commit:
        if body.strict:
            issues = _all_layout_issues(doc)
            errors = [i for i in issues if i["level"] == "error"]
            if errors:
                raise HTTPException(422, {
                    "message": "изменения не прошли проверку расстановки",
                    "errors": len(errors),
                    "issues": issues,
                })
        try:
            repo_put(pid, doc, owner=user.get("id"))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "committed": body.commit, "results": results,
            "project": doc if not body.commit else None}


def _all_layout_issues(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """План + объёмные коллизии без дублей."""
    seen: set[tuple] = set()
    out: list[dict[str, Any]] = []
    for issue in validate_layout(doc) + validate_scene(doc) + validate_standards(doc):
        key = (issue.get("code"), issue.get("instance"), issue.get("prop"),
               issue.get("message"))
        if key in seen:
            continue
        seen.add(key)
        out.append(issue)
    return out



def _module_cost(doc: dict[str, Any], inst: dict[str, Any]) -> tuple[float, Any]:
    """Стоимость одного модуля (total, currency)."""
    cfg, _ = cfg_for_shop(doc.get("shop"))
    globals_ = {k: v for k, v in (doc.get("globals") or {}).items()
                if k != "autoApply"}
    product = {**inst, "params": {**globals_,
                                  **(inst.get("params") or {})}}
    try:
        res = solve(product, cfg, market=doc.get("market"),
                    shop=doc.get("shop"), supplier=doc.get("supplier"))
    except Exception:
        return 0.0, None
    cost = res.get("cost") or {}
    return float(cost.get("total") or 0), cost.get("currency")


def _preview_cost_delta(
    before: dict[str, Any],
    after: dict[str, Any],
    changes: dict[str, Any],
) -> dict[str, Any]:
    """Считаем цену только по изменённым модулям — preview быстрый."""
    b = {str(x.get("id")): x for x in before.get("instances", [])}
    a = {str(x.get("id")): x for x in after.get("instances", [])}
    delta = 0.0
    currency = None
    try:
        for row in changes["instances"]["added"]:
            cost, cur = _module_cost(after, row)
            delta += cost
            currency = cur or currency
        for row in changes["instances"]["removed"]:
            cost, cur = _module_cost(before, row)
            delta -= cost
            currency = cur or currency
        for row in changes["instances"]["updated"]:
            iid = str(row["id"])
            cost_b, cur = _module_cost(before, b[iid])
            cost_a, _ = _module_cost(after, a[iid])
            delta += cost_a - cost_b
            currency = cur or currency
    except Exception:
        pass
    return {"delta": round(delta, 2), "currency": currency}


def _diff_dict(before: dict, after: dict) -> dict[str, Any]:
    keys = set(before) | set(after)
    keys.discard("id")
    changed: dict[str, Any] = {}
    for k in sorted(keys):
        if before.get(k) != after.get(k):
            changed[k] = {"before": before.get(k), "after": after.get(k)}
    return changed


def _diff_lists(before: list, after: list, key: str = "id") -> dict[str, Any]:
    b = {str(x.get(key)): x for x in before}
    a = {str(x.get(key)): x for x in after}
    added = [a[i] for i in a if i not in b]
    removed = [b[i] for i in b if i not in a]
    updated = []
    for i in a:
        if i not in b:
            continue
        changed = _diff_dict(b[i], a[i])
        if changed:
            updated.append({"id": i, "name": a[i].get("name"),
                            "fields": changed})
    return {"added": added, "removed": removed, "updated": updated}


@router.post("/api/projects/{pid}/preview")
def project_preview(pid: str, body: ActionIn, request: Request):
    """Предпросмотр пакета: ничего не сохраняет, отдаёт diff/ошибки/цену."""
    project_for(request, pid)
    common.heavy_limit(request, "layout", common.LAYOUT_PER_MIN)
    base = repo_get(pid)
    if base is None:
        raise HTTPException(404, "проект не найден")
    before = copy.deepcopy(base)
    after = copy.deepcopy(base)
    try:
        results = [apply_action(after, act) for act in body.actions]
    except Exception as exc:
        # Пакет атомарный: after выбрасывается, проект не меняется.
        raise HTTPException(422, {
            "message": str(exc), "atomic": True,
            "errors": 1,
        }) from exc
    issues = _all_layout_issues(after)
    errors = [i for i in issues if i["level"] == "error"]
    warnings = [i for i in issues if i["level"] != "error"]
    changes = {
        "instances": _diff_lists(before.get("instances", []),
                                 after.get("instances", [])),
        "props": _diff_lists(before.get("props", []),
                             after.get("props", [])),
        "openings": _diff_lists((before.get("room") or {}).get("openings", []),
                                (after.get("room") or {}).get("openings", [])),
        "room": _diff_dict(before.get("room") or {}, after.get("room") or {}),
        "globals": _diff_dict(before.get("globals") or {},
                              after.get("globals") or {}),
        "materials": _diff_dict(before.get("materials") or {},
                                after.get("materials") or {}),
        "folders": _diff_lists(before.get("folders") or [],
                               after.get("folders") or []),
        "zones": {"before": before.get("zones") or [],
                  "after": after.get("zones") or []},
        "project": (
            {"name": {"before": before.get("name"),
                      "after": after.get("name")}}
            if before.get("name") != after.get("name") else {}
        ),
    }
    cost = _preview_cost_delta(before, after, changes)
    return {
        "ok": True,
        "committed": False,
        "changes": changes,
        "summary": {
            "instances": len(after.get("instances", [])),
            "props": len(after.get("props", [])),
        },
        "cost": cost,
        "issues": issues,
        "errors": len(errors),
        "warnings": len(warnings),
        "results": results,
    }


@router.post("/api/projects/{pid}/cutting")
def project_cutting(pid: str, request: Request):
    """Раскрой всего проекта: общая укладка деталей всех модулей."""
    project_for(request, pid)
    common.heavy_limit(request, "layout", common.LAYOUT_PER_MIN)
    doc = repo_get(pid)
    if doc is None:
        raise HTTPException(404, "проект не найден")
    cfg, _ = cfg_for_shop(doc.get("shop"))
    globals_ = {k: v for k, v in (doc.get("globals") or {}).items()
                if k != "autoApply"}
    parts: list[Part] = []
    errors: list[str] = []
    for inst in doc.get("instances", []):
        product = {**inst, "params": {**globals_,
                                      **(inst.get("params") or {})}}
        try:
            res = solve(product, cfg, market=doc.get("market"),
                        shop=doc.get("shop"), supplier=doc.get("supplier"))
        except Exception as exc:  # один модуль не ломает раскрой остальных
            errors.append(f"{inst.get('name') or inst.get('id')}: {exc}")
            continue
        for row in res.get("parts", []):
            try:
                parts.append(Part(**row))
            except TypeError:
                continue
    if not parts:
        raise HTTPException(422, "нечего раскраивать: нет деталей")
    sheets, usable_w, usable_h = pack_sheets(parts, cfg)
    used = sum(float(p["w"]) * float(p["h"])
               for s in sheets for p in s.get("placements", []))
    area = max(1.0, usable_w * usable_h * max(1, len(sheets)))
    pieces = sum(len(s.get("placements", [])) for s in sheets)
    return {
        "ok": not errors,
        "errors": errors,
        "sheets": sheets,
        "totals": {
            "sheets": len(sheets), "pieces": pieces,
            "kpd": round(used / area * 100, 1),
            "materials": sorted({s["material"] for s in sheets}),
        },
        "sheet": {"w": usable_w, "h": usable_h,
                  "trim": cfg.trim, "kerf": cfg.kerf},
    }


@router.post("/api/projects/validate")
def validate_project_doc(doc: dict[str, Any], request: Request):
    """Проверить локальное состояние до сохранения (preflight UI/агента)."""
    user_or_401(request)
    common.heavy_limit(request, "preflight", common.VALIDATE_PER_MIN)
    if not isinstance(doc, dict):
        raise HTTPException(400, "ожидается JSON-объект")
    issues = _all_layout_issues(doc)
    errors = sum(1 for i in issues if i["level"] == "error")
    return {
        "ok": errors == 0,
        "errors": errors,
        "warnings": sum(1 for i in issues if i["level"] != "error"),
        "issues": issues,
    }


@router.get("/api/projects/{pid}/layout")
def project_layout(pid: str, request: Request):
    """Проверить расстановку мебели: стены, проёмы, зазоры, ориентация."""
    project_for(request, pid)
    common.heavy_limit(request, "layout", common.LAYOUT_PER_MIN)
    doc = repo_get(pid)
    if doc is None:
        raise HTTPException(404, "проект не найден")
    issues = _all_layout_issues(doc)
    return {
        "ok": not any(i["level"] == "error" for i in issues),
        "errors": sum(1 for i in issues if i["level"] == "error"),
        "warnings": sum(1 for i in issues if i["level"] != "error"),
        "issues": issues,
    }


@router.post("/api/projects/{pid}/layout/normalize")
def project_layout_normalize(pid: str, body: dict[str, Any], request: Request):
    """Привести к правилам: прижать к внутренним граням, закрыть зазоры,
    развернуть фасады. commit=true — сохранить результат."""
    user = project_for(request, pid)
    common.heavy_limit(request, "normalize", common.NORMALIZE_PER_MIN)
    doc = repo_get(pid)
    if doc is None:
        raise HTTPException(404, "проект не найден")
    fixed, changes, _ = normalize_layout(
        doc, close_gaps=bool(body.get("closeGaps", True)))
    if body.get("fixDecor", True):
        fixed, decor_changes, _ = normalize_scene(fixed)
        changes += decor_changes
    issues = _all_layout_issues(fixed)
    errors = sum(1 for i in issues if i["level"] == "error")
    committed = bool(body.get("commit")) and errors == 0
    if committed:
        repo_put(pid, fixed, owner=user.get("id"))
    return {
        "ok": errors == 0,
        "committed": committed,
        "changes": changes,
        "errors": errors,
        "warnings": sum(1 for i in issues if i["level"] != "error"),
        "issues": issues,
        # позиции/повороты нужны UI, чтобы применить результат без полной
        # перезагрузки проекта и повторного расчёта всех модулей
        "instances": [
            {"id": i.get("id"), "x": i.get("x"), "y": i.get("y"),
             "rot": i.get("rot")}
            for i in fixed.get("instances", [])
        ],
        "props": [
            {"id": p.get("id"), "x": p.get("x"), "y": p.get("y")}
            for p in fixed.get("props", [])
        ],
        "project": None if committed else fixed,
    }


@router.put("/api/projects/{pid}")
def put_project(pid: str, doc: dict[str, Any], request: Request,
                strict: bool = False):
    if not isinstance(doc, dict):
        raise HTTPException(400, "ожидается JSON-объект")
    user = project_for(request, pid)
    common.heavy_limit(request, "save", common.SAVE_PER_MIN)
    if strict:
        issues = _all_layout_issues(doc)
        errors = [i for i in issues if i["level"] == "error"]
        if errors:
            raise HTTPException(422, {
                "message": "проект не прошёл проверку расстановки",
                "errors": len(errors),
                "issues": issues,
            })
    try:
        path = repo_put(pid, doc, owner=user.get("id"))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "id": pid, "storage": path}


@router.get("/api/projects/{pid}/versions")
def list_versions(pid: str, request: Request):
    project_for(request, pid)
    if repo_get(pid) is None:
        raise HTTPException(404, "проект не найден")
    try:
        return {"versions": repo_list_versions(pid)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/projects/{pid}/versions")
def create_version(pid: str, request: Request, body: VersionIn | None = None):
    project_for(request, pid)
    doc = repo_get(pid)
    if doc is None:
        raise HTTPException(404, "проект не найден")
    name = (body.name if body else None) or "Снимок"
    vid = version_id()
    try:
        return {"version": repo_put_version(pid, vid, doc, name)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/api/projects/{pid}/versions/{vid}")
def get_version(pid: str, vid: str, request: Request):
    project_for(request, pid)
    try:
        ver = repo_get_version(pid, vid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if ver is None:
        raise HTTPException(404, "версия не найдена")
    return ver


@router.post("/api/projects/{pid}/versions/{vid}/restore")
def restore_version(pid: str, vid: str, request: Request,
                    body: RestoreIn | None = None):
    user = project_for(request, pid)
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
                pid, version_id(), current,
                f"Перед восстановлением: {ver.get('name') or vid}",
            )
    try:
        path = repo_put(pid, doc, owner=user.get("id"))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "restored": vid, "storage": path, "project": doc}


@router.delete("/api/projects/{pid}/versions/{vid}")
def delete_version(pid: str, vid: str, request: Request):
    project_for(request, pid)
    try:
        ok = repo_delete_version(pid, vid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not ok:
        raise HTTPException(404, "версия не найдена")
    return {"ok": True, "id": vid}


@router.delete("/api/projects/{pid}")
def delete_project(pid: str, request: Request):
    project_for(request, pid)
    try:
        ok = repo_delete(pid)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not ok:
        raise HTTPException(404, "проект не найден")
    return {"ok": True, "id": pid}
