#!/usr/bin/env python3
"""Генерирует TypeScript-справочник декора из specs/decor.yaml.

Источник истины — specs/decor.yaml. Файл
apps/web/src/state/decorCatalog.ts только генерируется, руками не правится.

    python3 tools/gen_decor_catalog.py           # перезаписать
    python3 tools/gen_decor_catalog.py --check   # проверить, что не разошёлся
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "specs" / "decor.yaml"
TARGET = ROOT / "apps" / "web" / "src" / "state" / "decorCatalog.ts"


def _q(value: object) -> str:
    # JSON-строка — валидный TS-литерал (кавычки, юникод, экранирование).
    return json.dumps(value, ensure_ascii=False)


def load_catalog() -> dict:
    data = yaml.safe_load(SOURCE.read_text(encoding="utf-8")) or {}
    groups = data.get("groups") or []
    types = data.get("types") or []
    presets = data.get("presets") or []

    if not groups or not types or not presets:
        raise SystemExit("specs/decor.yaml: нужны groups, types и presets")

    group_ids = [g["id"] for g in groups]
    if len(group_ids) != len(set(group_ids)):
        raise SystemExit("specs/decor.yaml: повторяются id групп")
    if len(types) != len(set(types)):
        raise SystemExit("specs/decor.yaml: повторяются типы")
    for t in types:
        if not isinstance(t, str) or not t:
            raise SystemExit(f"specs/decor.yaml: пустой тип {t!r}")

    keys = [p["key"] for p in presets]
    if len(keys) != len(set(keys)):
        raise SystemExit("specs/decor.yaml: повторяются key пресетов")
    for p in presets:
        for field in ("key", "type", "name", "category", "w", "d", "h", "color", "icon"):
            if field not in p:
                raise SystemExit(f"specs/decor.yaml: у {p.get('key')} нет {field}")
        if p["type"] not in types:
            raise SystemExit(
                f"specs/decor.yaml: тип {p['type']!r} у {p['key']} отсутствует в types")
        if p["category"] not in group_ids:
            raise SystemExit(
                f"specs/decor.yaml: категория {p['category']!r} у {p['key']} отсутствует в groups")
    return data


def render(data: dict) -> str:
    groups = data["groups"]
    types = data["types"]
    presets = data["presets"]
    labels = {g["id"]: g["label"] for g in groups}

    out: list[str] = []
    out.append("// AUTO-GENERATED from specs/decor.yaml by tools/gen_decor_catalog.py.")
    out.append("// Do not edit by hand. Change specs/decor.yaml and regenerate.")
    out.append("")
    out.append("export const DECOR_GROUPS = [")
    for g in groups:
        out.append(f"  {{ id: {_q(g['id'])}, label: {_q(g['label'])} }},")
    out.append("] as const")
    out.append("")
    out.append("export type DecorCategory = (typeof DECOR_GROUPS)[number]['id']")
    out.append("")
    out.append("export const DECOR_TYPES = [")
    for t in types:
        out.append(f"  {_q(t)},")
    out.append("] as const")
    out.append("")
    out.append("export type DecorType = (typeof DECOR_TYPES)[number]")
    out.append("")
    out.append("export interface DecorPreset {")
    out.append("  key: string")
    out.append("  type: DecorType")
    out.append("  name: string")
    out.append("  category: DecorCategory")
    out.append("  group: string")
    out.append("  w: number")
    out.append("  d: number")
    out.append("  h: number")
    out.append("  color: string")
    out.append("  accent?: string")
    out.append("  icon: string")
    out.append("}")
    out.append("")
    out.append("export const DECOR_PRESETS: DecorPreset[] = [")
    for p in presets:
        fields = [
            f"key: {_q(p['key'])}",
            f"type: {_q(p['type'])}",
            f"name: {_q(p['name'])}",
            f"category: {_q(p['category'])}",
            f"group: {_q(labels[p['category']])}",
            f"w: {p['w']}",
            f"d: {p['d']}",
            f"h: {p['h']}",
            f"color: {_q(p['color'])}",
        ]
        if p.get("accent"):
            fields.append(f"accent: {_q(p['accent'])}")
        fields.append(f"icon: {_q(p['icon'])}")
        out.append("  { " + ", ".join(fields) + " },")
    out.append("]")
    out.append("")
    return "\n".join(out)


def main() -> int:
    data = load_catalog()
    text = render(data)
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != text:
            print(f"РАСХОЖДЕНИЕ: {TARGET.relative_to(ROOT)} устарел. "
                  "Запустите python3 tools/gen_decor_catalog.py", file=sys.stderr)
            return 1
        print(f"ok: {TARGET.relative_to(ROOT)} совпадает с specs/decor.yaml")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(text, encoding="utf-8")
    print(f"записано: {TARGET.relative_to(ROOT)} "
          f"({len(data['types'])} типов, {len(data['presets'])} пресетов)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
