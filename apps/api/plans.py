"""Импорт планов помещения: PDF, изображения, DXF, SVG.

Задача — принять файл, который человек прислал (план квартиры, скриншот,
чертёж), показать его и по возможности достать комнату: контур, проёмы,
перегородки. Источники:

- PDF — текст и рендер страницы (pypdfium2); размеры ищутся в тексте;
- изображение — превью; геометрию читает vision-модель (если настроена);
- DXF — реальные отрезки/полилинии (ezdxf), контур по замкнутой полилинии;
- SVG — линии/полигоны/прямоугольники (lxml), контур по крупнейшему полигону.

Без vision-модели картинка не распознаётся: возвращаем превью и просим
размеры. PDF с текстовым слоем, DXF и SVG работают без неё.
"""
from __future__ import annotations

import base64
import io
import json
import math
import os
import re
import tempfile
from pathlib import Path
from typing import Any

import xml.etree.ElementTree as ET

import httpx
from PIL import Image, ImageOps

MAX_BYTES = 25 * 1024 * 1024
MAX_PREVIEW = 1600
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
DXF_EXT = {".dxf"}
SVG_EXT = {".svg"}
PDF_EXT = {".pdf"}

VISION_PROMPT = (
    "Ты читаешь строительные планы и чертежи помещений. Верни ТОЛЬКО JSON "
    "без пояснений. Единицы — миллиметры, план: x вправо, y вниз, начало "
    "координат в левом верхнем углу комнаты. Если размеры не читаются — "
    "поставь needs_dimensions=true и задай вопросы, ничего не выдумывай.\n"
    "Схема:\n"
    "{\n"
    '  "units": "mm",\n'
    '  "confidence": 0.0,\n'
    '  "needs_dimensions": false,\n'
    '  "questions": [],\n'
    '  "room": {"outline": [[0,0],[4200,0],[4200,3100],[0,3100]],\n'
    '           "height": 2700, "wallT": 100},\n'
    '  "openings": [{"kind":"window|door|arch","wall":0,"x":800,"w":1500,\n'
    '                "z0":900,"z1":2200,"confidence":0.8}],\n'
    '  "partitions": [{"a":[2000,0],"b":[2000,3100],"wallT":100}],\n'
    '  "furniture": [{"kind":"module|decor","preset":"base600",\n'
    '                 "name":"Тумба","x":0,"y":0,"w":600,"d":560,"h":720,\n'
    '                 "rot":0,"confidence":0.5}],\n'
    '  "notes": []\n'
    "}\n"
    "wall — индекс стены контура с 0 (по порядку точек outline). "
    "Для двери z0=0. Если на плане несколько комнат — бери главную "
    "(самую большую) и отметь это в notes."
)


class PlanError(Exception):
    """Файл не поддержан или повреждён."""


def detect_kind(filename: str, data: bytes) -> str:
    ext = Path(filename or "").suffix.lower()
    head = data[:4096]
    if head.startswith(b"%PDF"):
        return "pdf"
    if ext in DXF_EXT:
        return "dxf"
    if ext in SVG_EXT or b"<svg" in head.lower():
        return "svg"
    if ext in IMAGE_EXT:
        return "image"
    if head.startswith(b"\x89PNG") or head.startswith(b"\xff\xd8"):
        return "image"
    if head.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image"
    if head.startswith(b"BM"):
        return "image"
    raise PlanError(
        "формат не поддержан. Пришлите PDF, PNG/JPG/WEBP, DXF или SVG "
        "(DWG сохраните как DXF/PDF).",
    )


def _data_url_image(data: bytes, mime: str = "image/jpeg") -> str:
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def _to_jpeg(img: Image.Image) -> tuple[str, int, int]:
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.size
    k = min(1.0, MAX_PREVIEW / max(w, h))
    if k < 1.0:
        img = img.resize((max(1, int(w * k)), max(1, int(h * k))))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=84, optimize=True)
    return _data_url_image(buf.getvalue()), w, h


def _image(data: bytes) -> dict:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise PlanError(f"не удалось прочитать изображение: {exc}") from exc
    preview, w, h = _to_jpeg(img)
    return {"kind": "image", "preview": preview, "width": w, "height": h,
            "text": "", "notes": []}


def _pdf(data: bytes, page: int) -> dict:
    try:
        import pypdfium2 as pdfium
    except Exception as exc:  # noqa: BLE001
        raise PlanError("PDF-движок не установлен на сервере") from exc
    try:
        pdf = pdfium.PdfDocument(data)
    except Exception as exc:  # noqa: BLE001
        raise PlanError(f"не удалось открыть PDF: {exc}") from exc
    pages = len(pdf)
    index = max(0, min(pages - 1, int(page) - 1))
    p = pdf[index]
    width_pt, height_pt = p.get_size()
    scale = min(3.0, max(1.0, MAX_PREVIEW / max(width_pt, height_pt)))
    try:
        img = p.render(scale=scale).to_pil()
    except Exception as exc:  # noqa: BLE001
        raise PlanError(f"не удалось отрисовать PDF: {exc}") from exc
    preview, w, h = _to_jpeg(img)
    chunks: list[str] = []
    for n in range(pages):
        try:
            tp = pdf[n].get_textpage()
            text = tp.get_text_range()
        except Exception:
            text = ""
        if text.strip():
            chunks.append(f"--- стр. {n + 1} ---\n{text.strip()}")
    text = "\n".join(chunks)[:20000]
    return {
        "kind": "pdf", "preview": preview, "width": w, "height": h,
        "pages": pages, "page": index + 1, "text": text,
        "page_mm": {
            "w": round(width_pt * 25.4 / 72, 1),
            "h": round(height_pt * 25.4 / 72, 1),
        },
        "notes": [],
    }


def _shoelace(points: list[list[float]]) -> float:
    area = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2


def _bbox(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [float(p[0]) for p in points]
    ys = [float(p[1]) for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def _flip_translate(points: list[list[float]]) -> list[list[float]]:
    if not points:
        return []
    x0, y0, x1, y1 = _bbox([(p[0], p[1]) for p in points])
    out = []
    for x, y in points:
        out.append([round(float(x) - x0, 1), round(y1 - float(y), 1)])
    out.reverse()  # отражение по Y меняет обход — возвращаем CCW
    return out


def _points(raw: str) -> list[list[float]]:
    nums = [float(v) for v in re.findall(r"-?\d+(?:[.,]\d+)?", raw)]
    return [[nums[i], nums[i + 1]] for i in range(0, len(nums) - 1, 2)]


def _parse_len(value: str | None) -> tuple[float, str] | None:
    if not value:
        return None
    m = re.match(r"\s*(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m|px|pt)?", value)
    if not m:
        return None
    return float(m.group(1).replace(",", ".")), (m.group(2) or "px")


def _svg(data: bytes) -> dict:
    try:
        root = ET.fromstring(data)
    except Exception as exc:  # noqa: BLE001
        raise PlanError(f"не удалось прочитать SVG: {exc}") from exc
    vb = None
    if root.get("viewBox"):
        nums = [float(x) for x in re.findall(r"-?\d+(?:[.,]\d+)?",
                                             root.get("viewBox") or "")]
        if len(nums) == 4 and nums[2] > 0 and nums[3] > 0:
            vb = nums
    wl = _parse_len(root.get("width"))
    hl = _parse_len(root.get("height"))
    unit_scale = None
    if wl and wl[1] in ("mm", "cm", "m"):
        mm = wl[0] * {"mm": 1.0, "cm": 10.0, "m": 1000.0}[wl[1]]
        base = vb[2] if vb else (wl[0] or 1.0)
        unit_scale = mm / base if base else 1.0
    elif vb and max(vb[2], vb[3]) > 500:
        unit_scale = 1.0
    elif wl and wl[0] > 500:
        unit_scale = 1.0
    else:
        unit_scale = 1.0

    polys: list[list[list[float]]] = []
    lines: list[list[list[float]]] = []
    for el in root.iter():
        tag = str(el.tag).rsplit("}", 1)[-1].lower()
        if tag == "polygon":
            pts = _points(el.get("points") or "")
            if len(pts) >= 3:
                polys.append(pts)
        elif tag == "polyline":
            pts = _points(el.get("points") or "")
            if len(pts) >= 4 and pts[0] == pts[-1]:
                polys.append(pts[:-1])
            elif len(pts) >= 2:
                lines.append(pts)
        elif tag == "rect":
            x = float(el.get("x") or 0)
            y = float(el.get("y") or 0)
            w = float(el.get("width") or 0)
            h = float(el.get("height") or 0)
            if w > 0 and h > 0:
                polys.append([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
        elif tag == "line":
            lines.append([[
                float(el.get("x1") or 0), float(el.get("y1") or 0),
            ], [
                float(el.get("x2") or 0), float(el.get("y2") or 0),
            ]])
    if not polys and not lines:
        raise PlanError("в SVG нет линий/полигонов — пришлите PDF или PNG")
    scaled_polys = [
        [[round(x * unit_scale, 1), round(y * unit_scale, 1)] for x, y in p]
        for p in polys
    ]
    scaled_lines = [
        [[round(x * unit_scale, 1), round(y * unit_scale, 1)] for x, y in p]
        for p in lines
    ]
    if scaled_polys:
        best = max(scaled_polys, key=_shoelace)
        outline = _flip_translate(best)
        source = "замкнутый полигон SVG"
    else:
        pts = [p for line in scaled_lines for p in line]
        x0, y0, x1, y1 = _bbox([(p[0], p[1]) for p in pts])
        outline = [[0.0, 0.0], [round(float(x1 - x0), 1), 0.0],
                   [round(float(x1 - x0), 1), round(float(y1 - y0), 1)],
                   [0.0, round(float(y1 - y0), 1)]]
        source = "габариты линий SVG"
    note = "SVG: толщины стен и проёмы не распознаются автоматически"
    return {
        "kind": "svg", "preview": _data_url_image(data, "image/svg+xml"),
        "width": None, "height": None, "text": "",
        "outline": outline, "source": source,
        "units_known": wl is not None and wl[1] in ("mm", "cm", "m"),
        "notes": [note],
    }


def _dxf(data: bytes) -> dict:
    try:
        import ezdxf
    except Exception as exc:  # noqa: BLE001
        raise PlanError("DXF-движок не установлен на сервере") from exc
    tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False)
    try:
        tmp.write(data)
        tmp.close()
        try:
            doc = ezdxf.readfile(tmp.name)
        except Exception as exc:  # noqa: BLE001
            raise PlanError(f"не удалось прочитать DXF: {exc}") from exc
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    units = int(doc.header.get("$INSUNITS", 0) or 0)
    k = {1: 25.4, 2: 304.8, 4: 1.0, 5: 10.0, 6: 1000.0}.get(units, 1.0)
    msp = doc.modelspace()
    polys: list[list[list[float]]] = []
    lines: list[list[list[float]]] = []
    texts: list[str] = []
    segments = 0
    for e in msp:
        t = e.dxftype()
        try:
            if t == "LINE":
                a, b = e.dxf.start, e.dxf.end
                lines.append([[float(a.x) * k, float(a.y) * k],
                              [float(b.x) * k, float(b.y) * k]])
                segments += 1
            elif t == "LWPOLYLINE":
                pts = [[float(x) * k, float(y) * k]
                       for x, y in e.get_points("xy")]
                if len(pts) >= 2:
                    segments += len(pts) - 1
                if e.closed and len(pts) >= 3:
                    polys.append(pts)
                else:
                    lines.append(pts)
            elif t == "POLYLINE":
                pts = [[float(v.dxf.location.x) * k,
                        float(v.dxf.location.y) * k] for v in e.vertices]
                if len(pts) >= 2:
                    segments += len(pts) - 1
                if e.closed and len(pts) >= 3:
                    polys.append(pts)
                else:
                    lines.append(pts)
            elif t in ("TEXT", "MTEXT"):
                texts.append(str(e.dxf.text if t == "TEXT" else e.text))
        except Exception:
            continue

    all_pts = [p for line in lines for p in line]
    all_pts += [p for poly in polys for p in poly]
    if not all_pts:
        raise PlanError("в DXF нет отрезков/полилиний — пришлите PDF или PNG")
    if polys:
        best = max(polys, key=_shoelace)
        outline = _flip_translate(best)
        source = "замкнутая полилиния DXF"
    else:
        x0, y0, x1, y1 = _bbox([(p[0], p[1]) for p in all_pts])
        outline = [[0.0, 0.0], [round(float(x1 - x0), 1), 0.0],
                   [round(float(x1 - x0), 1), round(float(y1 - y0), 1)],
                   [0.0, round(float(y1 - y0), 1)]]
        source = "габариты линий DXF"
    known = units in (1, 2, 4, 5, 6)
    return {
        "kind": "dxf", "preview": None, "width": None, "height": None,
        "text": "\n".join(texts)[:5000], "outline": outline,
        "source": source, "segments": segments, "units": units,
        "units_known": known,
        "notes": [] if known else ["DXF без единиц: координаты приняты за мм"],
    }


def _to_mm(value: float, unit: str | None) -> float:
    if unit == "mm":
        return value
    if unit in ("cm", "см"):
        return value * 10
    if unit in ("m", "м"):
        return value * 1000
    if value < 50:
        return value * 1000
    if value < 1000:
        return value * 10
    return value


def dimensions_from_text(text: str) -> list[dict]:
    out: list[dict] = []
    rx = re.compile(
        r"(\d+(?:[.,]\d+)?)\s*(mm|см|cm|м|m)?\s*[x×х]\s*"
        r"(\d+(?:[.,]\d+)?)\s*(mm|см|cm|м|m)?",
        re.IGNORECASE,
    )
    for m in rx.finditer(text or ""):
        a = float(m.group(1).replace(",", "."))
        b = float(m.group(3).replace(",", "."))
        w = round(_to_mm(a, m.group(2)))
        d = round(_to_mm(b, m.group(4)))
        if 1200 <= w <= 12000 and 1200 <= d <= 12000:
            out.append({"w": w, "d": d, "raw": m.group(0).strip()})
        if len(out) >= 8:
            break
    return out


def _rect_plan(w: float, d: float, **extra: Any) -> dict:
    raw = {
        "units": "mm",
        "confidence": 0.35,
        "needs_dimensions": False,
        "questions": [],
        "room": {
            "w": round(w), "d": round(d),
            "outline": [[0, 0], [round(w), 0], [round(w), round(d)],
                        [0, round(d)]],
            "height": 2700, "wallT": 100,
        },
        "openings": [], "partitions": [], "furniture": [], "notes": [],
        "valid": True,
    }
    raw.update(extra)
    return normalize_plan(raw) or raw


def _wall_lengths(outline: list[list[float]]) -> list[float]:
    return [
        round(math.dist(outline[i], outline[(i + 1) % len(outline)]), 1)
        for i in range(len(outline))
    ]


def normalize_plan(raw: dict | None) -> dict | None:
    """Проверить и привести ответ модели/парсера к схеме проекта."""
    if not isinstance(raw, dict):
        return None
    notes = [str(x) for x in (raw.get("notes") or []) if x][:20]
    units = str(raw.get("units") or "mm").lower()
    k = {"m": 1000.0, "м": 1000.0, "cm": 10.0, "см": 10.0}.get(units, 1.0)
    room = raw.get("room") if isinstance(raw.get("room"), dict) else {}
    outline_raw = room.get("outline") if isinstance(room, dict) else None
    outline: list[list[float]] = []
    if isinstance(outline_raw, list):
        for p in outline_raw:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                try:
                    outline.append([round(float(p[0]) * k, 1),
                                    round(float(p[1]) * k, 1)])
                except (TypeError, ValueError):
                    continue
    if len(outline) < 3:
        w = float(room.get("w") or 0) * k
        d = float(room.get("d") or 0) * k
        if 1200 <= w <= 12000 and 1200 <= d <= 12000:
            outline = [[0, 0], [round(w), 0], [round(w), round(d)],
                       [0, round(d)]]
            notes.append("контур восстановлен по габаритам")
        else:
            return {
                "units": "mm", "confidence": 0.0,
                "needs_dimensions": True,
                "questions": [str(q) for q in (raw.get("questions") or [])][:5],
                "room": None, "openings": [], "partitions": [],
                "furniture": [], "notes": notes, "valid": False,
            }
    # начало координат — левый верхний угол
    x0, y0, x1, y1 = _bbox([(p[0], p[1]) for p in outline])
    if x0 or y0:
        outline = [[round(x - x0, 1), round(y - y0, 1)] for x, y in outline]
        x1, y1 = x1 - x0, y1 - y0
    if max(x1, y1) < 50:  # модель отдала метры без units
        outline = [[round(x * 1000, 1), round(y * 1000, 1)]
                   for x, y in outline]
        x1, y1 = x1 * 1000, y1 * 1000
        notes.append("координаты переведены из метров в мм")
    outline = [[min(12000.0, max(0.0, x)), min(12000.0, max(0.0, y))]
               for x, y in outline]
    w = round(max(p[0] for p in outline), 1)
    d = round(max(p[1] for p in outline), 1)
    lengths = _wall_lengths(outline)
    openings: list[dict] = []
    for o in raw.get("openings") or []:
        if not isinstance(o, dict):
            continue
        try:
            wall = int(o.get("wall") or 0)
            x = float(o.get("x") or 0) * k
            ow = float(o.get("w") or 0) * k
        except (TypeError, ValueError):
            continue
        if wall < 0 or wall >= len(outline) or ow <= 0:
            continue
        if ow > lengths[wall] + 1:
            ow = lengths[wall]
        x = max(0.0, min(x, max(0.0, lengths[wall] - ow)))
        kind = str(o.get("kind") or "window")
        if kind not in ("window", "door", "arch"):
            kind = "window"
        openings.append({
            "kind": kind, "wall": wall, "x": round(x, 1),
            "w": round(ow, 1),
            "z0": 0.0 if kind in ("door", "arch")
            else max(0.0, min(2500.0, float(o.get("z0") or 900) * k)),
            "z1": max(300.0, min(3000.0,
                                float(o.get("z1") or
                                      (2100 if kind in ("door", "arch")
                                       else 2200)) * k)),
            "confidence": round(float(o.get("confidence") or 0.5), 2),
        })
    partitions: list[dict] = []
    for p in raw.get("partitions") or []:
        if not isinstance(p, dict):
            continue
        a, b = p.get("a"), p.get("b")
        if not (isinstance(a, (list, tuple)) and len(a) >= 2
                and isinstance(b, (list, tuple)) and len(b) >= 2):
            continue
        partitions.append({
            "a": [round(float(a[0]) * k, 1), round(float(a[1]) * k, 1)],
            "b": [round(float(b[0]) * k, 1), round(float(b[1]) * k, 1)],
            "wallT": max(40, min(300, int(float(p.get("wallT") or 100)))),
        })
        if len(partitions) >= 20:
            break
    furniture: list[dict] = []
    for f in raw.get("furniture") or []:
        if not isinstance(f, dict):
            continue
        furniture.append({
            "kind": str(f.get("kind") or "decor"),
            "preset": str(f.get("preset") or ""),
            "name": str(f.get("name") or ""),
            "x": round(float(f.get("x") or 0) * k, 1),
            "y": round(float(f.get("y") or 0) * k, 1),
            "w": round(float(f.get("w") or 0) * k, 1),
            "d": round(float(f.get("d") or 0) * k, 1),
            "h": round(float(f.get("h") or 0) * k, 1),
            "rot": round(float(f.get("rot") or 0), 1),
            "confidence": round(float(f.get("confidence") or 0.5), 2),
        })
        if len(furniture) >= 40:
            break
    return {
        "units": "mm",
        "confidence": round(max(0.0, min(1.0,
                                         float(raw.get("confidence") or 0))), 2),
        "needs_dimensions": bool(raw.get("needs_dimensions")),
        "questions": [str(q) for q in (raw.get("questions") or [])][:5],
        "room": {
            "w": w, "d": d,
            "h": max(2000.0, min(4500.0, float(room.get("height") or 2700))),
            "wallT": max(40.0, min(300.0, float(room.get("wallT") or 100))),
            "outline": outline,
        },
        "openings": openings,
        "partitions": partitions,
        "furniture": furniture,
        "notes": notes,
        "valid": True,
    }


def vision_status() -> dict:
    model = (os.getenv("AI_VISION_MODEL") or "").strip()
    return {
        "configured": bool(model),
        "model": model,
        "hint": (
            "Распознавание изображений не настроено: задайте "
            "AI_VISION_MODEL (и ключ, если он другой) в .env. "
            "PDF с текстом, DXF и SVG работают и без него."
        ) if not model else "",
    }


def vision_plan(preview: str, text: str, filename: str) -> dict:
    status = vision_status()
    model = status["model"]
    if not model:
        return {"ok": False, "reason": "not_configured",
                "hint": status["hint"]}
    base = (os.getenv("AI_VISION_BASE_URL") or os.getenv("AI_BASE_URL")
            or "https://api.deepseek.com").rstrip("/")
    key = (os.getenv("AI_VISION_API_KEY") or os.getenv("AI_API_KEY")
           or os.getenv("DEEPSEEK_API_KEY") or "").strip()
    if not key:
        return {"ok": False, "reason": "no_key"}
    prompt = f"Файл: {filename}. Текст из PDF (если есть):\n{text[:8000]}"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": VISION_PROMPT},
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url",
                 "image_url": {"url": preview, "detail": "high"}},
            ]},
        ],
        "temperature": 0.1,
        "max_tokens": 4000,
    }
    try:
        with httpx.Client(timeout=float(os.getenv("AI_VISION_TIMEOUT", "120"))) as c:
            r = c.post(
                base + "/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=payload,
            )
    except httpx.HTTPError as exc:
        return {"ok": False, "model": model,
                "error": f"связь с vision-моделью: {exc.__class__.__name__}"}
    if r.status_code >= 400:
        return {"ok": False, "model": model,
                "error": f"vision HTTP {r.status_code}: {r.text[:300]}"}
    try:
        msg = (r.json().get("choices") or [{}])[0].get("message") or {}
        content = str(msg.get("content") or "")
    except Exception:
        return {"ok": False, "model": model, "error": "пустой ответ vision"}
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        return {"ok": False, "model": model,
                "error": "vision вернул не JSON", "raw": content[:500]}
    try:
        raw = json.loads(content[start:end + 1])
    except json.JSONDecodeError as exc:
        return {"ok": False, "model": model,
                "error": f"JSON vision: {exc}", "raw": content[:500]}
    plan = normalize_plan(raw)
    return {"ok": True, "model": model, "plan": plan}


def analyze_plan(data: bytes, filename: str, page: int = 1) -> dict:
    if not data:
        raise PlanError("пустой файл")
    if len(data) > MAX_BYTES:
        raise PlanError("файл больше 25 МБ — пришлите страницу плана или PDF")
    kind = detect_kind(filename, data)
    if kind == "image":
        info = _image(data)
    elif kind == "pdf":
        info = _pdf(data, page)
    elif kind == "svg":
        info = _svg(data)
    elif kind == "dxf":
        info = _dxf(data)
    else:  # pragma: no cover
        raise PlanError("неизвестный формат")

    dims = dimensions_from_text(info.get("text") or "")
    plan = None
    notes = list(info.get("notes") or [])

    if kind in ("dxf", "svg") and info.get("outline"):
        plan = normalize_plan({
            "units": "mm", "confidence": 0.8 if info.get("units_known") else 0.6,
            "needs_dimensions": False,
            "room": {"outline": info["outline"], "height": 2700,
                     "wallT": 100},
            "openings": [], "partitions": [], "furniture": [],
            "notes": notes + [f"контур: {info.get('source')}"],
        })
    elif kind == "pdf" and dims:
        first = dims[0]
        plan = _rect_plan(first["w"], first["d"],
                          notes=notes + [f"размеры из текста PDF: {first['raw']}"])
        plan["confidence"] = 0.35
    elif kind == "image":
        notes.append("изображение без распознавания: нужны размеры комнаты")

    vision: dict = {"ok": False, "reason": "not_applicable"}
    if kind in ("pdf", "image") and info.get("preview"):
        vision = vision_plan(info["preview"], info.get("text") or "", filename)
        if vision.get("ok") and vision.get("plan"):
            plan = vision["plan"]
        elif vision.get("reason") == "not_configured":
            notes.append(vision.get("hint") or "")

    return {
        "schema": "furniture/plan-import@1",
        "kind": kind,
        "filename": filename,
        "page": info.get("page"),
        "pages": info.get("pages"),
        "preview": info.get("preview"),
        "width": info.get("width"),
        "height": info.get("height"),
        "page_mm": info.get("page_mm"),
        "text": (info.get("text") or "")[:20000],
        "dimensions": dims,
        "vector": {
            "outline": info.get("outline"),
            "source": info.get("source"),
            "segments": info.get("segments"),
            "units": info.get("units"),
            "units_known": info.get("units_known"),
        } if kind in ("dxf", "svg") else None,
        "vision": vision,
        "vision_status": vision_status(),
        "plan": plan,
        "notes": [n for n in notes if n],
    }
