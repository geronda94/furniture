"""Цены и смета: рынок → цех → поставщик (specs/*.yaml).

Прайс-лист рынка лежит в specs/pricing/<market>.yaml. Цех переопределяет
формат листа, раскрой, кромку и сборку. Поставщик — цены фурнитуры и ручек.

Все суммы считаются в валюте рынка. Значения — данные, не правила; стартовые
цены помечены source/draft и должны быть сверены с конкретным цехом.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPECS = ROOT / "specs"
DEFAULT_PATH = SPECS / "pricing.yaml"          # legacy-прайс (RUB)
MARKETS_PATH = SPECS / "markets.yaml"
SHOPS_PATH = SPECS / "shops.yaml"
SUPPLIERS_PATH = SPECS / "suppliers.yaml"
PRICING_DIR = SPECS / "pricing"


def _read(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return {}
    try:
        import yaml
        data = yaml.safe_load(text)
    except Exception:
        try:
            data = json.loads(text)
        except Exception:
            data = None
    return data if isinstance(data, dict) else {}


@dataclass
class Pricing:
    currency: str = "RUB"
    locale: str = "ru-RU"
    symbol: str = "₽"
    vat_percent: float = 0.0
    market: str = "legacy"
    market_name: str = "Базовый прайс"
    shop: str = "legacy"
    shop_name: str = "Базовый цех"
    supplier: str = "generic"
    supplier_name: str = "Универсальная фурнитура"
    updated: str = ""
    source: str = ""
    draft: bool = False
    sheet_w: float = 2750.0
    sheet_h: float = 1830.0
    trim: float = 15.0
    kerf: float = 4.0
    waste_percent: float = 15.0
    materials: dict[str, float] = field(default_factory=dict)
    cutting_per_sheet: float = 380.0
    cutting_per_m2: float = 260.0
    edge: dict[str, float] = field(default_factory=dict)
    hinge: float = 180.0
    runner_pair: float = 2400.0
    leg: float = 90.0
    handle: float = 150.0
    fasteners: dict[str, float] = field(default_factory=dict)
    gas_strut: float = 0.0
    handle_prices: dict[str, float] = field(default_factory=dict)
    handle_factor: float = 1.0
    assembly_module: float = 900.0
    assembly_door: float = 350.0
    assembly_drawer: float = 450.0
    markup_percent: float = 25.0
    partner_percent: float = 10.0

    # --- цены по ключам -------------------------------------------------
    def edge_price(self, key: str, thickness: float | None = None) -> float:
        if key in self.edge:
            return float(self.edge[key])
        if thickness is not None:
            for k in (f"{thickness:g}", str(int(thickness))
                      if float(thickness).is_integer() else f"{thickness:g}"):
                if k in self.edge:
                    return float(self.edge[k])
        return 0.0

    def handle_price(self, handle_id: str, fallback: float = 0.0) -> float:
        if handle_id in self.handle_prices:
            return float(self.handle_prices[handle_id])
        base = fallback if fallback else self.handle
        return round(base * self.handle_factor, 2)

    def fastener_price(self, key: str) -> float:
        return float(self.fasteners.get(key, 0.0))

    def as_dict(self) -> dict:
        return {
            "market": self.market, "market_name": self.market_name,
            "shop": self.shop, "shop_name": self.shop_name,
            "supplier": self.supplier, "supplier_name": self.supplier_name,
            "currency": self.currency, "locale": self.locale,
            "symbol": self.symbol, "vat_percent": self.vat_percent,
            "updated": self.updated, "source": self.source,
            "draft": self.draft,
            "sheet": {"w": self.sheet_w, "h": self.sheet_h,
                      "trim": self.trim, "kerf": self.kerf},
            "markup_percent": self.markup_percent,
            "partner_percent": self.partner_percent,
        }


def _apply_pricelist(p: Pricing, data: dict) -> None:
    p.currency = str(data.get("currency", p.currency))
    p.locale = str(data.get("locale", p.locale))
    p.symbol = str(data.get("symbol", p.symbol))
    p.vat_percent = float(data.get("vat_percent", p.vat_percent))
    p.updated = str(data.get("updated", p.updated))
    p.source = str(data.get("source", p.source))
    p.waste_percent = float(data.get("waste_percent", p.waste_percent))
    p.materials = {str(k): float(v)
                   for k, v in (data.get("materials") or {}).items()}
    cut = data.get("cutting") or {}
    p.cutting_per_sheet = float(cut.get("per_sheet", p.cutting_per_sheet))
    p.cutting_per_m2 = float(cut.get("per_m2", p.cutting_per_m2))
    p.edge = {str(k): float(v) for k, v in (data.get("edge") or {}).items()}
    hw = data.get("hardware") or {}
    p.hinge = float(hw.get("hinge", p.hinge))
    p.runner_pair = float(hw.get("runner_pair", p.runner_pair))
    p.leg = float(hw.get("leg", p.leg))
    p.handle = float(hw.get("handle", p.handle))
    p.fasteners = {
        k: float(v) for k, v in hw.items()
        if k in ("confirmat", "minifix", "dowel", "shelf_pin", "screw")
    }
    p.gas_strut = float(hw.get("gas_strut", p.gas_strut))
    p.handle_prices = {
        str(k): float(v) for k, v in (data.get("handles") or {}).items()
    }
    asm = data.get("assembly") or {}
    p.assembly_module = float(asm.get("module", p.assembly_module))
    p.assembly_door = float(asm.get("door", p.assembly_door))
    p.assembly_drawer = float(asm.get("drawer", p.assembly_drawer))
    p.markup_percent = float(data.get("markup_percent", p.markup_percent))
    p.partner_percent = float(
        data.get("partner_commission_percent", p.partner_percent))


def load_options() -> dict:
    """Списки рынков/цехов/поставщиков для UI и API."""
    markets = _read(MARKETS_PATH)
    shops = _read(SHOPS_PATH)
    suppliers = _read(SUPPLIERS_PATH)
    mk = [{
        "id": str(m.get("id")), "name": str(m.get("name", m.get("id"))),
        "currency": str(m.get("currency", "")),
        "locale": str(m.get("locale", "")),
        "symbol": str(m.get("symbol", "")),
        "vat_percent": float(m.get("vat_percent", 0)),
        "source": str(m.get("source", "")),
    } for m in (markets.get("markets") or []) if isinstance(m, dict)
        and m.get("id")]
    sh = [{
        "id": str(s.get("id")), "name": str(s.get("name", s.get("id"))),
        "market": str(s.get("market", "")),
        "sheet": s.get("sheet") or {},
        "note": str(s.get("note", "")),
    } for s in (shops.get("shops") or []) if isinstance(s, dict) and s.get("id")]
    su = [{
        "id": str(s.get("id")), "name": str(s.get("name", s.get("id"))),
        "brands": s.get("brands") or [],
        "note": str(s.get("note", "")),
    } for s in (suppliers.get("suppliers") or [])
        if isinstance(s, dict) and s.get("id")]
    return {
        "markets": mk,
        "shops": sh,
        "suppliers": su,
        "default": {
            "market": str(markets.get("default", "ro")),
            "shop": str(shops.get("default", sh[0]["id"] if sh else "")),
            "supplier": str(suppliers.get("default", "generic")),
        },
    }


def _find(rows: list, item_id: str | None) -> dict | None:
    if not item_id:
        return None
    for row in rows:
        if isinstance(row, dict) and str(row.get("id")) == item_id:
            return row
    return None


def load_pricing(
    path: str | Path | None = None,
    *,
    market: str | None = None,
    shop: str | None = None,
    supplier: str | None = None,
) -> Pricing:
    """Собрать прайс: рынок → прайс-лист → цех → поставщик.

    `path` — legacy-прайс (specs/pricing.yaml) для обратной совместимости.
    """
    if path:
        p = Pricing()
        _apply_pricelist(p, _read(Path(path)))
        return p

    p = Pricing()
    opts = load_options()
    markets_doc = _read(MARKETS_PATH)
    shops_doc = _read(SHOPS_PATH)
    suppliers_doc = _read(SUPPLIERS_PATH)

    market_id = market or str(markets_doc.get("default", "ro"))
    mrow = _find(markets_doc.get("markets") or [], market_id)
    if not mrow:
        market_id = str(markets_doc.get("default", "ro"))
        mrow = _find(markets_doc.get("markets") or [], market_id)
    if mrow:
        p.market = market_id
        p.market_name = str(mrow.get("name", market_id))
        p.currency = str(mrow.get("currency", p.currency))
        p.locale = str(mrow.get("locale", p.locale))
        p.symbol = str(mrow.get("symbol", p.symbol))
        p.vat_percent = float(mrow.get("vat_percent", p.vat_percent))
        p.source = str(mrow.get("source", p.source))
        price_file = PRICING_DIR / str(mrow.get("file", f"{market_id}.yaml"))
        data = _read(price_file)
        if data:
            _apply_pricelist(p, data)
        else:
            p.draft = True
            p.source = f"нет прайса {price_file.name}: используется базовый"
            _apply_pricelist(p, _read(DEFAULT_PATH))
    else:
        p.market = "legacy"
        p.market_name = "Базовый прайс"
        p.draft = True
        _apply_pricelist(p, _read(DEFAULT_PATH))

    # ---- цех ---------------------------------------------------------
    shop_id = shop or str(shops_doc.get("default", ""))
    srow = _find(shops_doc.get("shops") or [], shop_id)
    if not srow and shop_id not in ("", "shop-default"):
        shop_id = str(shops_doc.get("default", shop_id))
        srow = _find(shops_doc.get("shops") or [], shop_id)
    elif not srow:
        shop_id = str(shops_doc.get("default", shop_id))
        srow = _find(shops_doc.get("shops") or [], shop_id)
    if srow:
        p.shop = shop_id
        p.shop_name = str(srow.get("name", shop_id))
        sheet = srow.get("sheet") or {}
        p.sheet_w = float(sheet.get("w", p.sheet_w))
        p.sheet_h = float(sheet.get("h", p.sheet_h))
        p.trim = float(sheet.get("trim", p.trim))
        p.kerf = float(sheet.get("kerf", p.kerf))
        cut = srow.get("cutting") or {}
        p.cutting_per_sheet = float(cut.get("per_sheet",
                                            p.cutting_per_sheet))
        p.cutting_per_m2 = float(cut.get("per_m2", p.cutting_per_m2))
        edge = srow.get("edge") or {}
        if edge:
            p.edge.update({str(k): float(v) for k, v in edge.items()})
        asm = srow.get("assembly") or {}
        p.assembly_module = float(asm.get("module", p.assembly_module))
        p.assembly_door = float(asm.get("door", p.assembly_door))
        p.assembly_drawer = float(asm.get("drawer", p.assembly_drawer))

    # ---- поставщик ---------------------------------------------------
    supplier_id = supplier or str(suppliers_doc.get("default", "generic"))
    urow = _find(suppliers_doc.get("suppliers") or [], supplier_id)
    if not urow:
        supplier_id = str(suppliers_doc.get("default", "generic"))
        urow = _find(suppliers_doc.get("suppliers") or [], supplier_id)
    if urow:
        p.supplier = supplier_id
        p.supplier_name = str(urow.get("name", supplier_id))
        hw = urow.get("hardware") or {}
        if "hinge" in hw:
            p.hinge = float(hw["hinge"])
        if "runner_pair" in hw:
            p.runner_pair = float(hw["runner_pair"])
        if "gas_strut" in hw:
            p.gas_strut = float(hw["gas_strut"])
        if "leg" in hw:
            p.leg = float(hw["leg"])
        if "handle" in hw:
            p.handle = float(hw["handle"])
        p.handle_factor = float(urow.get("handle_factor",
                                         p.handle_factor))
        p.handle_prices.update({
            str(k): float(v) for k, v in (urow.get("handles") or {}).items()
        })
        p.fasteners.update({
            str(k): float(v) for k, v in (urow.get("fasteners") or {}).items()
        })
    return p


def load_legacy_pricing(path: str | Path | None = None) -> Pricing:
    return load_pricing(path or DEFAULT_PATH)
