"""Выгрузка деталировки: CSV, JSON, XLSX, отчёт."""
from __future__ import annotations

import csv
import json
from dataclasses import asdict
from pathlib import Path

from .config import Config


def write_outputs(W, H, D, parts, sheets, holes, errs, warns, out: Path, cfg):
    out.mkdir(parents=True, exist_ok=True)
    # CSV
    with open(out / "parts.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f, delimiter=";")
        wr.writerow(["Деталь", "Кол-во", "Чистовой W", "Чистовой H",
                     "Пильный W", "Пильный H", "Кромка", "Материал", "Текстура"])
        for p in parts:
            sw, sh = p.saw()
            wr.writerow([p.name, p.qty, p.w, p.h, sw, sh,
                         p.edge_summary(), p.material, p.grain])
    # JSON
    data = {"corpus": {"W": W, "H": H, "D": D}, "config": asdict(cfg),
            "parts": [dict(asdict(p), saw_w=p.saw()[0], saw_h=p.saw()[1])
                      for p in parts],
            "drilling": holes,
            "sheets": sheets,
            "validation": {"errors": errs, "warnings": warns}}
    (out / "parts.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    # XLSX
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font
        wb = Workbook()
        ws = wb.active
        ws.title = "Деталировка"
        head = ["Деталь", "Кол-во", "Чистовой W", "Чистовой H", "Пильный W",
                "Пильный H", "Кромка (Л/В/П/Н)", "Материал", "Текстура"]
        ws.append(head)
        for c in ws[1]:
            c.font = Font(bold=True)
        for p in parts:
            sw, sh = p.saw()
            ws.append([p.name, p.qty, p.w, p.h, sw, sh, p.edge_summary(),
                       p.material, p.grain])
        for col, wd in zip("ABCDEFGHI", [18, 8, 12, 12, 12, 12, 18, 10, 12]):
            ws.column_dimensions[col].width = wd
        wb.save(out / "parts.xlsx")
    except ImportError:
        pass
    # report
    lines = ["ОТЧЁТ ДВИЖКА МЕБЕЛИ", "=" * 40,
             f"Корпус: {W:.0f} × {H:.0f} × {D:.0f} мм",
             f"Плита {cfg.t:g} мм, ДВП {cfg.t_back:g} мм, "
             f"фурнитура {cfg.hardware}",
             f"Лист {cfg.sheet_w:.0f}×{cfg.sheet_h:.0f}, пропил {cfg.kerf:g}, "
             f"обрез {cfg.trim:g}", "", "ДЕТАЛИРОВКА:"]
    for p in parts:
        sw, sh = p.saw()
        lines.append(f"  {p.name:<16} ×{p.qty}  чистовой {p.w:g}×{p.h:g}  "
                     f"пильный {sw:g}×{sh:g}  кромка[{p.edge_summary()}]")
    lines += ["", f"ПРИСАДКА: {len(holes)} позиций"]
    lines += ["", f"РАСКРОЙ: листов {len(sheets)} "
              f"({', '.join(s['material'] + '×1' for s in sheets)})"]
    lines += ["", "ВАЛИДАЦИЯ:"]
    lines += [f"  ОШИБКА: {e}" for e in errs] or ["  ошибок нет"]
    lines += [f"  предупр.: {w}" for w in warns]
    (out / "report.txt").write_text("\n".join(lines), encoding="utf-8")
    return "\n".join(lines)
