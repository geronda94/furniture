#!/usr/bin/env python3
"""Golden-тесты движка.

Каждая фикстура прогоняется через публичный CLI, выходные файлы хэшируются.
Любое изменение геометрии/раскроя/присадки ломает тест — это защита перед
рефакторингом (см. AGENTS.md: не менять tools/*.py без прогона проверки).

    python3 tests/golden.py            # проверить
    python3 tests/golden.py --update   # перезаписать эталоны (осознанно!)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
GOLDEN = Path(__file__).resolve().parent / "golden.json"

FIXTURES = [
    {
        "name": "cabinet-600",
        "cmd": ["engine.py", "--w", "600", "--h", "720", "--d", "560",
                "--shelves", "2", "--doors", "1"],
        "files": ["parts.json", "parts.csv", "cutting.svg", "report.txt"],
    },
    {
        "name": "cabinet-900-overlay",
        "cmd": ["engine.py", "--w", "900", "--h", "2100", "--d", "560",
                "--shelves", "3", "--doors", "2", "--roof", "overlay"],
        "files": ["parts.json", "parts.csv", "cutting.svg", "report.txt"],
    },
    {
        "name": "kitchen-600",
        "cmd": ["kitchen.py", "--sections", "600:1:0:Тумба"],
        "files": ["parts.json", "parts.csv", "cutting.svg", "report.txt",
                  "scene3d.json", "kitchen_facade.dxf", "kitchen_parts.dxf"],
    },
    {
        "name": "kitchen-mixed",
        "cmd": ["kitchen.py", "--sections",
                "800:2:1:Мойка,600:0:3:Ящики,400:1:0:Пенал"],
        "files": ["parts.json", "parts.csv", "cutting.svg", "report.txt",
                  "scene3d.json", "kitchen_facade.dxf", "kitchen_parts.dxf"],
    },
    {
        "name": "kitchen-overlay-open",
        "cmd": ["kitchen.py", "--sections", "1200:2:0:Пенал",
                "--frame", "overlay", "--open", "0"],
        "files": ["parts.json", "parts.csv", "cutting.svg", "report.txt",
                  "scene3d.json", "kitchen_facade.dxf", "kitchen_parts.dxf"],
    },
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def run_fixture(fx: dict) -> dict[str, str]:
    with tempfile.TemporaryDirectory(prefix=f"golden-{fx['name']}-") as tmp:
        out = Path(tmp)
        cmd = [sys.executable, str(TOOLS / fx["cmd"][0]), *fx["cmd"][1:],
               "--out", str(out)]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise SystemExit(
                f"[{fx['name']}] CLI вернул {proc.returncode}\n"
                f"{proc.stdout}\n{proc.stderr}")
        hashes = {}
        for name in fx["files"]:
            path = out / name
            if not path.exists():
                raise SystemExit(f"[{fx['name']}] нет файла {name}")
            hashes[name] = digest(path)
        return hashes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true",
                    help="перезаписать golden.json текущими хэшами")
    args = ap.parse_args()

    actual = {fx["name"]: run_fixture(fx) for fx in FIXTURES}

    if args.update:
        GOLDEN.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n",
                          encoding="utf-8")
        print(f"Эталоны записаны: {GOLDEN}")
        return 0

    if not GOLDEN.exists():
        raise SystemExit("Нет golden.json — сначала запусти с --update")

    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    failed = 0
    for name, files in actual.items():
        exp = expected.get(name)
        if exp is None:
            print(f"НОВАЯ  {name} — нет эталона")
            failed += 1
            continue
        diffs = [f for f in files if files[f] != exp.get(f)]
        if diffs:
            failed += 1
            print(f"FAIL   {name}: {', '.join(diffs)}")
            for f in diffs:
                print(f"         {f}: {exp.get(f)} -> {files[f]}")
        else:
            print(f"ok     {name}")

    if failed:
        print(f"\nПровалено: {failed}. Если изменения намеренные — "
              f"запусти с --update и опиши причину в docs/10-standards.md.")
        return 1
    print("\nВсе эталоны совпали.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
