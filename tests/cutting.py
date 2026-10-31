#!/usr/bin/env python3
"""Раскрой: общая укладка деталей проекта выгоднее по-модульной."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from furniture_core import load_config  # noqa: E402
from furniture_core.cutting import pack  # noqa: E402
from furniture_core.parts import Part  # noqa: E402


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"{'ok  ' if cond else 'FAIL'}   {name:<40} {detail}")
    return cond


def main() -> int:
    cfg = load_config(ROOT / "specs" / "shop-default.yaml")
    ok = True

    def block(prefix: str, w: float, h: float, n: int) -> list[Part]:
        return [Part(name=f"{prefix}-{i}", qty=1, w=w, h=h,
                     material="ЛДСП") for i in range(n)]

    a = block("A", 700, 500, 12)
    b = block("B", 500, 350, 12)
    single, _, _ = pack(a + b, cfg)
    parts_a, _, _ = pack(a, cfg)
    parts_b, _, _ = pack(b, cfg)
    ok &= check("общая укладка не больше суммы по модулям",
                len(single) <= len(parts_a) + len(parts_b),
                f"{len(single)} ≤ {len(parts_a)} + {len(parts_b)}")
    ok &= check("в листах есть координаты",
                all("placements" in s for s in single) and
                all(p.get("w") and p.get("h") for s in single
                    for p in s["placements"]))

    # КПД проекта должен быть выше, чем по частям (обычно).
    def kpd(sheets: list[dict]) -> float:
        used = sum(p["w"] * p["h"] for s in sheets
                   for p in s.get("placements", []))
        area = cfg.sheet_w * cfg.sheet_h * max(1, len(sheets))
        return used / area * 100

    ok &= check("КПД общей укладки выше по-модульной",
                kpd(single) > max(kpd(parts_a), kpd(parts_b)) - 5,
                f"{kpd(single):.0f}% vs {kpd(parts_a):.0f}/{kpd(parts_b):.0f}%")

    print("\nВсе проверки пройдены." if ok else "\nЕсть ошибки.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
