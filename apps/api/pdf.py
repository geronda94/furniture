"""Серверный PDF коммерческого предложения (A4, кириллица)."""
from __future__ import annotations

import io
import os
from datetime import date
from pathlib import Path
from typing import Any

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (
        Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
    )
except ModuleNotFoundError as exc:  # noqa: BLE001 — без reportlab живём
    # PDF — необязательная выгрузка: отсутствие пакета не должно ронять API.
    PDF_ERROR = f"PDF недоступен: {exc}"
else:
    PDF_ERROR = ""

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
COMPANY = os.getenv("QUOTE_COMPANY", "Furniture constructor")
PHONE = os.getenv("QUOTE_PHONE", "")
EMAIL = os.getenv("QUOTE_EMAIL", "")
SITE = os.getenv("QUOTE_SITE", "")
if not PDF_ERROR:
    ACCENT = colors.HexColor("#c2861f")
    DARK = colors.HexColor("#23282d")
    MUTED = colors.HexColor("#6b737a")

_registered = False


def _fonts() -> tuple[str, str]:
    """DejaVu для кириллицы; если нет — встроенный Helvetica."""
    global _registered
    if not _registered:
        try:
            pdfmetrics.registerFont(TTFont(
                "App", str(FONT_DIR / "DejaVuSans.ttf")))
            pdfmetrics.registerFont(TTFont(
                "App-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
            _registered = True
        except Exception:  # noqa: BLE001 — шрифт не критичен для запуска
            return "Helvetica", "Helvetica-Bold"
    return "App", "App-Bold"


def _money(v: float, symbol: str) -> str:
    return f"{v:,.0f}".replace(",", " ") + " " + symbol


def build_quote(
    doc: dict[str, Any],
    modules: list[dict[str, Any]],
    meta: dict[str, Any],
) -> bytes:
    """PDF: шапка, таблица модулей, итоги и примечания.

    modules: [{name, w, h, d, pieces, sheets, cost}]
    """
    if PDF_ERROR:
        raise RuntimeError(PDF_ERROR)
    regular, bold = _fonts()
    brand = meta.get("brand") or {}
    company = str(brand.get("company") or COMPANY)
    phone = str(brand.get("phone") or PHONE)
    email = str(brand.get("email") or EMAIL)
    site = str(brand.get("site") or SITE)
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "T", parent=styles["Title"], fontName=bold, fontSize=20,
        leading=24, textColor=DARK, spaceAfter=2, alignment=0,
    )
    sub = ParagraphStyle(
        "S", parent=styles["Normal"], fontName=regular, fontSize=9,
        leading=13, textColor=MUTED,
    )
    h2 = ParagraphStyle(
        "H2", parent=styles["Normal"], fontName=bold, fontSize=11,
        leading=15, textColor=DARK, spaceBefore=10, spaceAfter=4,
    )
    cell = ParagraphStyle(
        "C", parent=styles["Normal"], fontName=regular, fontSize=8.5,
        leading=11, textColor=DARK,
    )
    head = ParagraphStyle(
        "Head", parent=cell, fontName=bold, textColor=colors.white,
    )
    total = sum(float(m.get("cost") or 0) for m in modules)
    symbol = str(meta.get("symbol") or meta.get("currency") or "")
    room = doc.get("room") or {}

    buf = io.BytesIO()
    pdf = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=18 * mm,
        title=str(doc.get("name") or "Коммерческое предложение"),
        author="Furniture constructor",
    )

    def footer(canvas, _doc) -> None:
        canvas.saveState()
        canvas.setFont(regular, 7.5)
        canvas.setFillColor(MUTED)
        left = f"{company} · расчёт по стандартам ГОСТ/EN"
        if phone:
            left += f" · {phone}"
        if email:
            left += f" · {email}"
        canvas.drawString(18 * mm, 10 * mm, left)
        logo = brand.get("logo")
        if logo:
            try:
                canvas.drawImage(
                    logo, A4[0] - 18 * mm - 26 * mm, A4[1] - 12 * mm - 26 * mm,
                    width=26 * mm, height=26 * mm,
                    preserveAspectRatio=True, anchor="ne", mask="auto",
                )
            except Exception:  # noqa: BLE001 — битый логотип не ломает КП
                pass
        canvas.drawRightString(
            A4[0] - 18 * mm, 10 * mm, f"стр. {canvas.getPageNumber()}")
        canvas.setStrokeColor(colors.HexColor("#e2ded6"))
        canvas.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm)
        canvas.restoreState()

    story: list[Any] = []
    story.append(Paragraph("Коммерческое предложение", title))
    story.append(Paragraph(
        f"{doc.get('name') or 'Проект'} · {date.today().strftime('%d.%m.%Y')}"
        f" · {meta.get('market_name') or ''}", sub))
    contacts = " · ".join(x for x in (phone, email, site) if x)
    if contacts:
        story.append(Paragraph(contacts, sub))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Помещение: {room.get('w', 0):.0f} × {room.get('d', 0):.0f} × "
        f"{room.get('h', 0):.0f} мм · цех: {meta.get('shop_name') or '—'} · "
        f"поставщик: {meta.get('supplier_name') or '—'}", sub))
    story.append(Spacer(1, 10))

    rows: list[list[Any]] = [[
        Paragraph("№", head), Paragraph("Модуль", head),
        Paragraph("Габарит, мм", head), Paragraph("Деталей", head),
        Paragraph("Листов", head), Paragraph("Стоимость", head),
    ]]
    for i, m in enumerate(modules, start=1):
        rows.append([
            Paragraph(str(i), cell),
            Paragraph(str(m.get("name") or "—"), cell),
            Paragraph(f"{m.get('w', 0):.0f}×{m.get('h', 0):.0f}"
                      f"×{m.get('d', 0):.0f}", cell),
            Paragraph(str(m.get("pieces") or 0), cell),
            Paragraph(str(m.get("sheets") or 0), cell),
            Paragraph(_money(float(m.get("cost") or 0), symbol), cell),
        ])
    table = Table(rows, colWidths=[
        10 * mm, 76 * mm, 32 * mm, 20 * mm, 18 * mm, 28 * mm,
    ], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#23282d")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), bold),
        ("FONTSIZE", (0, 0), (-1, 0), 8.5),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#faf8f4")]),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#ddd8cf")),
        ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
    ]))
    story.append(table)
    story.append(Spacer(1, 8))

    story.append(Table(
        [[Paragraph("Итого по проекту", ParagraphStyle(
            "Tot", parent=cell, fontName=bold, fontSize=11,
            textColor=DARK)),
          Paragraph(_money(total, symbol), ParagraphStyle(
              "TotV", parent=cell, fontName=bold, fontSize=13,
              textColor=ACCENT, alignment=2))]],
        colWidths=[120 * mm, 64 * mm],
        style=TableStyle([
            ("LINEABOVE", (0, 0), (-1, 0), 1, ACCENT),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
        ]),
    ))

    story.append(Paragraph("Что входит", h2))
    for line in (
        "Деталировка с размерами, кромкой и присадкой (координаты отверстий).",
        "Раскрой листов с картой и координатами каждой детали.",
        "Фурнитура и крепёж: петли, направляющие, ручки, полкодержатели, опоры.",
        "Смета по материалам, работам и фурнитуре в ценах выбранного рынка.",
    ):
        story.append(Paragraph(f"• {line}", sub))

    story.append(Paragraph("Примечания", h2))
    story.append(Paragraph(
        "Смета предварительная: точные цены подтверждаются после согласования "
        "материалов и фурнитуры. Деталировка, раскрой, присадка и перечни "
        "фурнитуры прилагаются отдельными файлами (XLSX/DXF/CSV). "
        "Необратимые действия (заказ раскроя, оплата) — только после "
        "подтверждения заказчика.", sub))
    req = " · ".join(str(brand.get(k)) for k in ("address", "bank", "vat")
                     if brand.get(k))
    if req:
        story.append(Paragraph(req, sub))
    note = str(brand.get("note") or "")
    if note:
        story.append(Paragraph(note, sub))
    if meta.get("draft"):
        story.append(Paragraph(
            "Внимание: часть цен — заготовка, требуется обновление прайса.", sub))

    pdf.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
