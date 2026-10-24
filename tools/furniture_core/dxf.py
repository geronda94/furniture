"""DXF-выгрузки: фасад кухни и деталировка."""
from __future__ import annotations

import subprocess

from .config import Config
from .kitchen import MAX_DOOR_W, MAX_DRW_W, _split_count


def _line(x1, y1, x2, y2, layer="0"):
    return (f"0\nLINE\n8\n{layer}\n10\n{x1:.1f}\n20\n{y1:.1f}\n"
            f"11\n{x2:.1f}\n21\n{y2:.1f}\n")


def _text(x, y, h, s, layer="TEXT"):
    s = s.replace("\n", " ")
    return (f"0\nTEXT\n8\n{layer}\n10\n{x:.1f}\n20\n{y:.1f}\n"
            f"40\n{h:.1f}\n1\n{s}\n")


def _rect(x, y, w, h, layer="0"):
    return (_line(x, y, x + w, y, layer)
            + _line(x + w, y, x + w, y + h, layer)
            + _line(x + w, y + h, x, y + h, layer)
            + _line(x, y + h, x, y, layer))


def write_dxf(entities, path):
    body = "".join(entities)
    doc = ("0\nSECTION\n2\nENTITIES\n" + body + "0\nENDSEC\n0\nEOF\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc)


def facade_dxf(sections, cfg: Config, path, open_sections=()):
    e = []
    y0 = cfg.plinth_h
    total_w = sum(s.width for s in sections)
    e.append(_text(0, y0 + cfg.corpus_h + cfg.worktop_t + 80, 60,
                   f"КУХНЯ — фасад, {total_w:.0f} мм, "
                   f"{len(sections)} секций"))
    # столешница
    e.append(_rect(0, y0 + cfg.corpus_h, total_w, cfg.worktop_t, "WORKTOP"))
    e.append(_line(0, y0, 0, y0 + cfg.corpus_h, "0"))
    e.append(_line(0, 0, total_w, 0, "0"))
    x = 0.0
    for i, s in enumerate(sections):
        W = s.width
        is_open = i in open_sections
        has_facade = (s.doors + s.drawers) > 0 and not is_open
        # корпус
        e.append(_rect(x, y0, W, cfg.corpus_h, "CORPUS"))
        # цоколь (утоплен на 50)
        e.append(_rect(x + 50, 0, W - 100, cfg.plinth_h, "PLINTH"))
        # вертикали между секциями
        if i > 0:
            e.append(_line(x, 0, x, y0 + cfg.corpus_h, "0"))
        # фасады (с авто-делением — как в деталировке)
        if has_facade:
            fh_total = cfg.corpus_h - cfg.gap_top - cfg.gap_bottom
            fy = y0 + cfg.gap_bottom
            if s.drawers and s.doors:
                top_h = 200.0
                _draw_row_dxf(e, x, fy + fh_total - top_h, W, top_h, 1,
                              MAX_DRW_W, cfg)
                dh = fh_total - top_h - cfg.gap_between
                _draw_row_dxf(e, x, fy, W, dh, s.doors, MAX_DOOR_W, cfg)
            elif s.drawers:
                nd = _split_count(W, s.drawers, cfg, MAX_DRW_W)
                dh = (fh_total - (nd - 1) * cfg.gap_between) / nd
                yy = fy
                for _ in range(nd):
                    _draw_row_dxf(e, x, yy, W, dh, 1, MAX_DRW_W, cfg)
                    yy += dh + cfg.gap_between
            else:
                _draw_row_dxf(e, x, fy, W, fh_total, s.doors, MAX_DOOR_W, cfg)
        else:
            e.append(_text(x + W / 2 - 120, y0 + cfg.corpus_h / 2, 40,
                           "ОТКР.", "TEXT"))
        # подпись секции
        e.append(_text(x + 20, y0 + cfg.corpus_h + 20, 40,
                       f"{i + 1}. {s.label()} {s.width:.0f}", "TEXT"))
        # размер ширины
        e.append(_dim(x, -80, x + W, -80, f"{W:.0f}"))
        x += W
    # габарит
    e.append(_dim(0, -180, total_w, -180, f"ИТОГО {total_w:.0f}"))
    write_dxf(e, path)


def _draw_row_dxf(e, x, y, W, dh, requested, maxw, cfg):
    n = _split_count(W, requested, cfg, maxw)
    fw = (W - 2 * cfg.gap_side - (n - 1) * cfg.gap_between) / n
    xx = x + cfg.gap_side
    for _ in range(n):
        e.append(_rect(xx, y, fw, dh, "FACADE"))
        xx += fw + cfg.gap_between


def _dim(x1, y, x2, y2, label):
    return "".join([
        _line(x1, y, x2, y2, "DIM"),
        _line(x1, y - 30, x1, y + 30, "DIM"),
        _line(x2, y2 - 30, x2, y2 + 30, "DIM"),
        _text((x1 + x2) / 2 - 30, y + 40, 40, label, "DIM"),
    ])


def parts_dxf(parts, path):
    """Деталировка: каждая деталь как прямоугольник, раскладка по колонкам."""
    e = []
    e.append(_text(0, 120, 60,
                   "ДЕТАЛИРОВКА (чистовые размеры; подписаны кромки)"))
    seen = {}
    for p in parts:
        key = (p.name, p.w, p.h, tuple(sorted(p.edges.items())))
        if key not in seen:
            seen[key] = [p, 0]
        seen[key][1] += p.qty
    items = sorted(seen.values(), key=lambda x: -(x[0].w * x[0].h))
    ncols = 5
    col_w = 2100.0
    cols = [0.0] * ncols
    for p, qty in items:
        c = min(range(ncols), key=lambda i: cols[i])
        x = c * col_w
        y = cols[c]
        e.append(_rect(x, y, p.w, p.h, "PART"))
        e.append(_text(x, y + p.h + 25, 38, f"{p.name}  x{qty}", "TEXT"))
        edge_txt = " ".join(f"{k}{v:g}" for k, v in p.edges.items() if v) \
            or "без кромки"
        e.append(_text(x, y + p.h + 72, 32,
                       f"{p.w:.0f}x{p.h:.0f}  кромка: {edge_txt}", "TEXT"))
        cols[c] = y + p.h + 200
    write_dxf(e, path)


def render(dxf, png):
    try:
        subprocess.run(["cadcraft-cli", "convert", dxf, png],
                       check=True, capture_output=True)
        return True
    except Exception as ex:
        print("  (рендер не удался:", ex, ")")
        return False
