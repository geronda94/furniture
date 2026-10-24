#!/usr/bin/env python3
"""CLI: параметрическая мебель — деталировка + раскрой.

Тонкая обёртка над `furniture_core` (совместимость со старыми командами).
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture_core import (  # noqa: E402
    gen_drilling, gen_parts, load_config, pack, svg_cutting, validate,
    write_outputs,
)


def main():
    ap = argparse.ArgumentParser(
        description="Параметрическая мебель: деталировка+раскрой")
    ap.add_argument("--w", type=float, required=True, help="ширина корпуса, мм")
    ap.add_argument("--h", type=float, required=True, help="высота корпуса, мм")
    ap.add_argument("--d", type=float, required=True, help="глубина корпуса, мм")
    ap.add_argument("--shelves", type=int, default=0)
    ap.add_argument("--doors", type=int, default=0)
    ap.add_argument("--roof", choices=["inset", "overlay"], default="inset")
    ap.add_argument("--hardware", choices=["blum", "hettich", "gtv"],
                    default="blum")
    ap.add_argument("--t", type=float, default=16.0)
    ap.add_argument("--config", default=None)
    ap.add_argument("--out", default="out")
    a = ap.parse_args()

    cfg = load_config(a.config)
    cfg.hardware = a.hardware
    cfg.t = a.t
    parts = gen_parts(a.w, a.h, a.d, a.shelves, a.doors, a.roof, cfg)
    holes = gen_drilling(a.w, a.h, a.d, a.shelves, a.doors, a.roof, parts, cfg)
    sheets, uw, uh = pack(parts, cfg)
    errs, warns = validate(a.w, a.h, a.d, parts, cfg, sheets, uw, uh)
    out = Path(a.out)
    report = write_outputs(a.w, a.h, a.d, parts, sheets, holes, errs, warns,
                           out, cfg)
    svg_cutting(sheets, cfg, out / "cutting.svg")
    print(report)
    if errs:
        sys.exit(1)


if __name__ == "__main__":
    main()
