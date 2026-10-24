"""Раскрой (MaxRects, best short side fit) и валидация."""
from __future__ import annotations

from pathlib import Path

from .config import Config
from .parts import Part


def orientations(pw, ph, glen):
    """Возможные укладки. Волокно должно лечь вдоль длинной оси листа (гориз.)."""
    if glen == 0:
        return [(pw, ph, False), (ph, pw, True)]
    if abs(glen - pw) < 0.01:
        return [(pw, ph, False)]
    if abs(glen - ph) < 0.01:
        return [(ph, pw, True)]
    return [(pw, ph, False), (ph, pw, True)]


def _prune(rects):
    out = []
    for i, r in enumerate(rects):
        x, y, w, h = r
        contained = False
        for j, s in enumerate(rects):
            if i == j:
                continue
            x2, y2, w2, h2 = s
            if x2 <= x + 1e-6 and y2 <= y + 1e-6 and \
               x + w <= x2 + w2 + 1e-6 and y + h <= y2 + h2 + 1e-6:
                if (w2, h2) != (w, h) or j < i:
                    contained = True
                    break
        if not contained:
            out.append(r)
    return out


def _place_sheet(items, W, H, kerf):
    """Уложить максимум деталей на один лист. Возврат (placed, unplaced)."""
    free = [(0.0, 0.0, W, H)]
    placed, unplaced = [], []
    for it in items:
        best = None
        for (fx, fy, fw, fh) in free:
            for (w, h, rot) in orientations(it["w"], it["h"], it.get("glen", 0)):
                if w <= fw + 1e-6 and h <= fh + 1e-6:
                    lh, lv = abs(fw - w), abs(fh - h)
                    score = (min(lh, lv), max(lh, lv))
                    if best is None or score < best[0]:
                        best = (score, (fx, fy, w, h, rot))
        if best is None:
            unplaced.append(it)
            continue
        fx, fy, w, h, rot = best[1]
        placed.append({"name": it["name"], "x": round(fx, 1), "y": round(fy, 1),
                       "w": round(w, 1), "h": round(h, 1), "rot": rot})
        nf = []
        for (rx, ry, rw, rh) in free:
            if fx + w + kerf <= rx + 1e-6 or rx + rw <= fx + 1e-6 or \
               fy + h + kerf <= ry + 1e-6 or ry + rh <= fy + 1e-6:
                nf.append((rx, ry, rw, rh))
                continue
            if fy > ry:
                nf.append((rx, ry, rw, fy - ry))
            if fy + h + kerf < ry + rh:
                nf.append((rx, fy + h + kerf, rw, ry + rh - (fy + h + kerf)))
            if fx > rx:
                nf.append((rx, ry, fx - rx, rh))
            if fx + w + kerf < rx + rw:
                nf.append((fx + w + kerf, ry, rx + rw - (fx + w + kerf), rh))
        free = _prune(nf)
    return placed, unplaced


def pack(parts, cfg: Config):
    usable_w = cfg.sheet_w - 2 * cfg.trim
    usable_h = cfg.sheet_h - 2 * cfg.trim
    sheets = []
    for material in sorted({p.material for p in parts}):
        items = []
        for p in parts:
            if p.material != material:
                continue
            pw, ph = p.saw()
            for _ in range(p.qty):
                items.append({"name": p.name, "w": pw, "h": ph,
                              "glen": p.grain_len})
        items.sort(key=lambda i: max(i["w"], i["h"]), reverse=True)
        remaining = items
        while remaining:
            placed, unplaced = _place_sheet(remaining, usable_w, usable_h,
                                            cfg.kerf)
            if not placed:                       # деталь физически не влезает
                sheets.append({"material": material, "placements": [],
                               "overflow": [u["name"] for u in remaining]})
                break
            sheets.append({"material": material, "placements": placed})
            remaining = unplaced
    return sheets, usable_w, usable_h


def svg_cutting(sheets, cfg, path):
    pad, scale = 20, 0.22
    sw = cfg.sheet_w * scale + 2 * pad
    sh = cfg.sheet_h * scale + 2 * pad
    gap = 40
    cols = 1
    total_w = sw * cols + gap * (cols - 1) + 2 * pad
    total_h = (sh + 30) * len(sheets) + 2 * pad
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w:.0f}" '
           f'height="{total_h:.0f}" font-family="sans-serif">',
           f'<rect width="100%" height="100%" fill="#f4f4f4"/>']
    for si, s in enumerate(sheets):
        ox = pad
        oy = pad + si * (sh + 30)
        out.append(f'<text x="{ox}" y="{oy - 6}" font-size="13" '
                   f'fill="#333">{s["material"]} — лист {si + 1} '
                   f'({cfg.sheet_w:.0f}×{cfg.sheet_h:.0f})</text>')
        out.append(f'<rect x="{ox}" y="{oy}" width="{cfg.sheet_w * scale:.1f}" '
                   f'height="{cfg.sheet_h * scale:.1f}" fill="#fff" '
                   f'stroke="#888"/>')
        for p in s["placements"]:
            px = ox + (cfg.trim + p["x"]) * scale
            py = oy + (cfg.trim + p["y"]) * scale
            pw = p["w"] * scale
            ph = p["h"] * scale
            out.append(f'<rect x="{px:.1f}" y="{py:.1f}" width="{pw:.1f}" '
                       f'height="{ph:.1f}" fill="#cfe3ff" stroke="#3b6ea5"/>')
            if pw > 34 and ph > 12:
                out.append(f'<text x="{px + pw / 2:.1f}" y="{py + ph / 2:.1f}" '
                           f'font-size="9" text-anchor="middle" fill="#123">'
                           f'{p["name"]}</text>')
    out.append("</svg>")
    Path(path).write_text("\n".join(out), encoding="utf-8")


def validate(W, H, D, parts, cfg: Config, sheets, usable_w, usable_h):
    errs, warns = [], []
    for p in parts:
        pw, ph = p.saw()
        if pw <= 0 or ph <= 0:
            errs.append(f"{p.name}: недопустимый размер {pw}×{ph}")
        cands = orientations(pw, ph, p.grain_len)
        if not any(w <= usable_w + 0.01 and h <= usable_h + 0.01
                   for w, h, _ in cands):
            errs.append(f"{p.name} {pw}×{ph} не влезает в лист ни в одной "
                        f"укладке (полезно {usable_w:.0f}×{usable_h:.0f})")

    for s in sheets:
        if s.get("overflow"):
            errs.append(f"Лист {s['material']}: не размещены "
                        f"{', '.join(s['overflow'])}")
    if D < 37 + 37:
        warns.append("Глубина < 74 мм — System 32 не помещается")
    if cfg.gap_between < 2 or cfg.gap_between > 4:
        warns.append(f"Зазор между фасадами {cfg.gap_between} мм вне 2–4")
    for p in parts:
        for k, v in p.edges.items():
            if v > cfg.t:
                errs.append(f"{p.name}: кромка {v} мм > толщины плиты")
    return errs, warns
