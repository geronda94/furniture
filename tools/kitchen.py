#!/usr/bin/env python3
"""CLI: кухня — многoсекционный корпус + DXF + сцена для Blender/2.5D.

Тонкая обёртка над `furniture_core` (совместимость со старыми командами).
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furniture_core import (  # noqa: E402
    Config, facade_dxf, gen_kitchen, pack, parse_sections, parts_dxf, render,
    scene3d, svg_cutting, validate, write_outputs,
)
from furniture_core.hardware import find_runner, load_runners  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", required=True,
                    help="'1600:2:1:Тумба,...' width:doors:drawers:name")
    ap.add_argument("--open", default="", help="индексы открытых секций, 3,5")
    ap.add_argument("--t", type=float, default=16.0)
    ap.add_argument("--frame", choices=["inset", "overlay"], default=None,
                    help="схема каркаса: inset (вкладная) | overlay (накладная)")
    ap.add_argument("--runners", default=None,
                    help="id направляющих из specs/hardware.yaml")
    ap.add_argument("--out", default="out_kitchen")
    ap.add_argument("--config", default=None)
    a = ap.parse_args()

    cfg = Config(t=a.t)
    if a.frame:
        cfg.frame = a.frame
    cfg.gap_side, cfg.gap_between = 2.0, 3.0
    if a.runners:
        cfg.runners = a.runners
    runner = find_runner(load_runners(), cfg.runners)
    sections = parse_sections(a.sections, cfg)
    open_sections = tuple(int(x) for x in a.open.split(",") if x.strip())
    parts, total_w, holes = gen_kitchen(sections, cfg, open_sections, runner)

    out = a.out
    os.makedirs(out, exist_ok=True)
    sheets, uw, uh = pack(parts, cfg)
    errs, warns = validate(total_w, cfg.corpus_h, cfg.corpus_d, parts, cfg,
                           sheets, uw, uh)
    write_outputs(total_w, cfg.corpus_h, cfg.corpus_d, parts, sheets, holes,
                  errs, warns, Path(out), cfg)
    svg_cutting(sheets, cfg, os.path.join(out, "cutting.svg"))

    fdxf = os.path.join(out, "kitchen_facade.dxf")
    pdxf = os.path.join(out, "kitchen_parts.dxf")
    facade_dxf(sections, cfg, fdxf, open_sections)
    parts_dxf(parts, pdxf)
    render(fdxf, os.path.join(out, "kitchen_facade.png"))
    render(pdxf, os.path.join(out, "kitchen_parts.png"))

    s3d = scene3d(sections, cfg, open_sections, runner)
    with open(os.path.join(out, "scene3d.json"), "w", encoding="utf-8") as f:
        json.dump(s3d, f, ensure_ascii=False)
    print(f"3D-объектов: {len(s3d)}")

    ld = [s for s in sheets if s["material"] == "ЛДСП"]
    usable = ((cfg.sheet_w - 2 * cfg.trim)
              * (cfg.sheet_h - 2 * cfg.trim))
    used = sum(pl["w"] * pl["h"] for s in ld for pl in s["placements"])
    kpd = 100 * used / (len(ld) * usable) if ld else 0
    hinges = sum(h.get("hinges", 0) for h in holes)
    print(f"Кухня: {len(sections)} секций, длина {total_w:.0f} мм, "
          f"деталей-позиций {len(parts)}, "
          f"всего деталей {sum(p.qty for p in parts)}")
    print(f"Листов всего: {len(sheets)} (ЛДСП {len(ld)}, КПД ~{kpd:.0f}%), "
          f"петель: {hinges}")
    for e in errs:
        print("  ОШИБКА:", e)
    for w in warns:
        print("  предупр.:", w)
    print("Файлы:", ", ".join(sorted(os.listdir(out))))


if __name__ == "__main__":
    main()
