#!/usr/bin/env python3
"""Контракт справочника декора: specs/decor.yaml — единый источник.

Проверяем:
  * схему YAML (уникальные группы/типы/ключи, ссылки пресетов);
  * API-загрузчик отдаёт то же;
  * сгенерированный TS совпадает с YAML (tools/gen_decor_catalog.py --check);
  * у каждого типа есть 3D-билдер в render3d/props/builders.ts.

    python3 tests/decor.py
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from apps.api.decor import decor_catalog, decor_types  # noqa: E402

SOURCE = ROOT / "specs" / "decor.yaml"
GENERATED = ROOT / "apps" / "web" / "src" / "state" / "decorCatalog.ts"
BUILDERS = ROOT / "apps" / "web" / "src" / "render3d" / "props" / "builders.ts"


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"{'ok  ' if cond else 'FAIL'}   {name:<36} {detail}")
    return cond


def main() -> int:
    ok = True
    raw = yaml.safe_load(SOURCE.read_text(encoding="utf-8")) or {}
    groups = raw.get("groups") or []
    types = raw.get("types") or []
    presets = raw.get("presets") or []

    ok &= check("yaml: группы", len(groups) == 7, str(len(groups)))
    ok &= check("yaml: типы", len(types) == 18, str(len(types)))
    ok &= check("yaml: пресеты", len(presets) == 28, str(len(presets)))
    group_ids = [g["id"] for g in groups]
    ok &= check("yaml: id групп уникальны", len(group_ids) == len(set(group_ids)))
    ok &= check("yaml: типы уникальны", len(types) == len(set(types)))
    keys = [p["key"] for p in presets]
    ok &= check("yaml: key пресетов уникальны", len(keys) == len(set(keys)))
    ok &= check(
        "yaml: тип каждого пресета объявлен",
        all(p["type"] in types for p in presets),
    )
    ok &= check(
        "yaml: категория каждого пресета объявлена",
        all(p["category"] in group_ids for p in presets),
    )

    catalog = decor_catalog()
    ok &= check("api: типы = yaml", catalog.get("types") == types)
    ok &= check("api: пресеты = yaml", catalog.get("presets") == presets)
    ok &= check("api: decor_types() = yaml", decor_types() == types)

    gen = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "gen_decor_catalog.py"), "--check"],
        cwd=ROOT, text=True, capture_output=True,
    )
    ok &= check("ts: сгенерирован из yaml", gen.returncode == 0,
                gen.stderr.strip() or gen.stdout.strip())

    build_text = BUILDERS.read_text(encoding="utf-8")
    block = build_text.split("export const PROP_BUILDERS", 1)[-1]
    built = set(re.findall(r"['\"]?([a-z][a-z-]*)['\"]?\s*:\s*build", block))
    ok &= check("3d: билдер на каждый тип", built == set(types),
                f"нет: {sorted(set(types) - built)}")

    ok &= check("ts: типы в сгенерированном файле",
                all(f'"{t}"' in GENERATED.read_text(encoding="utf-8")
                    for t in types))

    print("\nВсе проверки пройдены." if ok else "\nЕсть ошибки.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
