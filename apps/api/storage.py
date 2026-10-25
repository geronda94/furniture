"""Хранилище проектов: PostgreSQL в Docker или файлы при локальном запуске.

Если задан DATABASE_URL — проекты лежат в таблице projects (JSONB).
Без DATABASE_URL — fallback на projects/<id>/project.json (как раньше).
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PROJECTS = ROOT / "projects"
PID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
VID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
SCHEMA = "furniture/project@0"

_dsn = os.getenv("DATABASE_URL", "").strip()
_ready = False


def using_db() -> bool:
    return bool(_dsn)


def _conn():
    import psycopg  # lazy: не нужен при файловом режиме
    return psycopg.connect(_dsn, autocommit=True)


def _init() -> None:
    global _ready
    if _ready or not _dsn:
        return
    with _conn() as con:
        with con.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS projects (
                  id text PRIMARY KEY,
                  name text NOT NULL DEFAULT '',
                  doc jsonb NOT NULL,
                  updated timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS project_versions (
                  project_id text NOT NULL,
                  id text NOT NULL,
                  name text NOT NULL DEFAULT '',
                  doc jsonb NOT NULL,
                  created timestamptz NOT NULL DEFAULT now(),
                  PRIMARY KEY (project_id, id)
                )
                """
            )
    _ready = True


def _check_id(pid: str) -> None:
    if not PID_RE.match(pid):
        raise ValueError("недопустимый id проекта")


def _file_path(pid: str) -> Path:
    _check_id(pid)
    return PROJECTS / pid / "project.json"


def _versions_dir(pid: str) -> Path:
    _check_id(pid)
    return PROJECTS / pid / "versions"


def _check_vid(vid: str) -> None:
    if not VID_RE.match(vid):
        raise ValueError("недопустимый id версии")


def list_projects() -> list[dict[str, Any]]:
    if _dsn:
        _init()
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    "SELECT id, name, updated FROM projects ORDER BY updated DESC"
                )
                rows = cur.fetchall()
        return [
            {"id": r[0], "name": r[1] or r[0],
             "updated": r[2].astimezone(timezone.utc).isoformat()}
            for r in rows
        ]
    out: list[dict[str, Any]] = []
    if PROJECTS.exists():
        for d in sorted(PROJECTS.iterdir()):
            f = d / "project.json"
            if not f.exists():
                continue
            try:
                doc = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            out.append({
                "id": d.name,
                "name": doc.get("name", d.name),
                "updated": datetime.fromtimestamp(
                    f.stat().st_mtime, timezone.utc).isoformat(),
            })
    return out


def get_project(pid: str) -> dict[str, Any] | None:
    if _dsn:
        _init()
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute("SELECT doc FROM projects WHERE id = %s", (pid,))
                row = cur.fetchone()
        return row[0] if row else None
    f = _file_path(pid)
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def put_project(pid: str, doc: dict[str, Any]) -> str:
    if doc.get("schema") != SCHEMA:
        raise ValueError(f"schema должна быть {SCHEMA}")
    if _dsn:
        _init()
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO projects (id, name, doc, updated)
                    VALUES (%s, %s, %s::jsonb, now())
                    ON CONFLICT (id) DO UPDATE
                      SET name = EXCLUDED.name, doc = EXCLUDED.doc,
                          updated = now()
                    """,
                    (pid, str(doc.get("name", "")),
                     json.dumps(doc, ensure_ascii=False)),
                )
        return f"db:{pid}"
    f = _file_path(pid)
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    tmp.replace(f)
    return str(f.relative_to(ROOT))


def delete_project(pid: str) -> bool:
    if _dsn:
        _init()
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute("DELETE FROM project_versions WHERE project_id = %s",
                            (pid,))
                cur.execute("DELETE FROM projects WHERE id = %s", (pid,))
                return cur.rowcount > 0
    f = _file_path(pid)
    if not f.exists():
        return False
    f.unlink()
    vdir = _versions_dir(pid)
    if vdir.exists():
        for item in vdir.iterdir():
            item.unlink(missing_ok=True)
        try:
            vdir.rmdir()
        except OSError:
            pass
    try:
        f.parent.rmdir()
    except OSError:
        pass
    return True


def list_versions(pid: str) -> list[dict[str, Any]]:
    """Снимки проекта, новые сверху."""
    if _dsn:
        _init()
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, created,
                           CASE WHEN jsonb_typeof(doc->'instances') = 'array'
                                THEN jsonb_array_length(doc->'instances')
                                ELSE 0 END
                    FROM project_versions
                    WHERE project_id = %s
                    ORDER BY created DESC
                    """,
                    (pid,),
                )
                rows = cur.fetchall()
        return [
            {"id": r[0], "name": r[1] or r[0],
             "created": r[2].astimezone(timezone.utc).isoformat(),
             "instances": int(r[3] or 0)}
            for r in rows
        ]
    vdir = _versions_dir(pid)
    if not vdir.exists():
        return []
    out: list[dict[str, Any]] = []
    for f in vdir.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        doc = data.get("doc") or {}
        out.append({
            "id": data.get("id") or f.stem,
            "name": data.get("name") or f.stem,
            "created": data.get("created") or "",
            "instances": len(doc.get("instances") or []),
        })
    out.sort(key=lambda v: v.get("created") or "", reverse=True)
    return out


def get_version(pid: str, vid: str) -> dict[str, Any] | None:
    _check_id(pid)
    _check_vid(vid)
    if _dsn:
        _init()
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, created, doc
                    FROM project_versions
                    WHERE project_id = %s AND id = %s
                    """,
                    (pid, vid),
                )
                row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "name": row[1],
                "created": row[2].astimezone(timezone.utc).isoformat(),
                "doc": row[3]}
    f = _versions_dir(pid) / f"{vid}.json"
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def put_version(pid: str, vid: str, doc: dict[str, Any],
                name: str, created: str | None = None) -> dict[str, Any]:
    _check_id(pid)
    _check_vid(vid)
    now = created or datetime.now(timezone.utc).isoformat()
    if _dsn:
        _init()
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO project_versions
                      (project_id, id, name, doc, created)
                    VALUES (%s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (project_id, id) DO UPDATE
                      SET name = EXCLUDED.name, doc = EXCLUDED.doc,
                          created = EXCLUDED.created
                    """,
                    (pid, vid, name, json.dumps(doc, ensure_ascii=False), now),
                )
        return {"id": vid, "name": name, "created": now,
                "instances": len(doc.get("instances") or [])}
    vdir = _versions_dir(pid)
    vdir.mkdir(parents=True, exist_ok=True)
    payload = {"id": vid, "name": name, "created": now, "doc": doc}
    f = vdir / f"{vid}.json"
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    tmp.replace(f)
    return {"id": vid, "name": name, "created": now,
            "instances": len(doc.get("instances") or [])}


def delete_version(pid: str, vid: str) -> bool:
    _check_id(pid)
    _check_vid(vid)
    if _dsn:
        _init()
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    "DELETE FROM project_versions WHERE project_id = %s AND id = %s",
                    (pid, vid),
                )
                return cur.rowcount > 0
    f = _versions_dir(pid) / f"{vid}.json"
    if not f.exists():
        return False
    f.unlink()
    try:
        f.parent.rmdir()
    except OSError:
        pass
    return True
