#!/usr/bin/env python3
"""Проверить project.json перед выдачей (ИИ-агент / CI).

Пример:
    python3 tools/validate_project.py projects/demo-apartment/project.json
    python3 tools/validate_project.py --json project.json

Код возврата 1, если есть ошибки. Предупреждения не блокируют, но их надо
разобрать. Это тот же набор правил, что отдаёт GET /api/projects/{id}/layout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from furniture_core.layout import validate_layout  # noqa: E402
from furniture_core.scene import validate_scene  # noqa: E402
from furniture_core.standards import validate_standards  # noqa: E402


def all_issues(doc: dict) -> list[dict]:
    seen: set[tuple] = set()
    out: list[dict] = []
    for issue in validate_layout(doc) + validate_scene(doc) + validate_standards(doc):
        key = (issue.get("code"), issue.get("instance"), issue.get("prop"),
               issue.get("message"))
        if key in seen:
            continue
        seen.add(key)
        out.append(issue)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("project", type=Path)
    ap.add_argument("--json", action="store_true", help="вывести JSON")
    args = ap.parse_args()
    try:
        doc = json.loads(args.project.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"не удалось прочитать {args.project}: {exc}", file=sys.stderr)
        return 2
    issues = all_issues(doc)
    errors = [i for i in issues if i.get("level") == "error"]
    warnings = [i for i in issues if i.get("level") != "error"]
    if args.json:
        print(json.dumps({
            "ok": not errors, "errors": len(errors),
            "warnings": len(warnings), "issues": issues,
        }, ensure_ascii=False, indent=2))
    else:
        for i in issues:
            mark = "ERROR" if i.get("level") == "error" else "WARN "
            where = i.get("instance") or i.get("prop") or ""
            print(f"{mark} {i['code']} {where}: {i['message']}")
        print(f"\n{len(errors)} ошибок · {len(warnings)} предупреждений")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
