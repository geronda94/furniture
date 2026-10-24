"""Цены и смета (данные из specs/pricing.yaml)."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "specs" / "pricing.yaml"


@dataclass
class Pricing:
    currency: str = "RUB"
    waste_percent: float = 15.0
    materials: dict[str, float] = field(default_factory=dict)
    cutting_per_sheet: float = 380.0
    cutting_per_m2: float = 260.0
    edge: dict[str, float] = field(default_factory=dict)
    hinge: float = 180.0
    runner_pair: float = 2400.0
    leg: float = 90.0
    handle: float = 150.0
    assembly_module: float = 900.0
    assembly_door: float = 350.0
    assembly_drawer: float = 450.0
    markup_percent: float = 25.0
    partner_percent: float = 10.0


def load_pricing(path: str | Path | None = None) -> Pricing:
    p = Pricing()
    f = Path(path) if path else DEFAULT_PATH
    if not f.exists():
        return p
    try:
        text = f.read_text(encoding="utf-8")
        try:
            import yaml
            data = yaml.safe_load(text) or {}
        except Exception:
            import json
            data = json.loads(text)
    except Exception:
        return p
    if not isinstance(data, dict):
        return p
    p.currency = str(data.get("currency", p.currency))
    p.waste_percent = float(data.get("waste_percent", p.waste_percent))
    p.materials = {str(k): float(v) for k, v in (data.get("materials") or {}).items()}
    cut = data.get("cutting") or {}
    p.cutting_per_sheet = float(cut.get("per_sheet", p.cutting_per_sheet))
    p.cutting_per_m2 = float(cut.get("per_m2", p.cutting_per_m2))
    p.edge = {str(k): float(v) for k, v in (data.get("edge") or {}).items()}
    hw = data.get("hardware") or {}
    p.hinge = float(hw.get("hinge", p.hinge))
    p.runner_pair = float(hw.get("runner_pair", p.runner_pair))
    p.leg = float(hw.get("leg", p.leg))
    p.handle = float(hw.get("handle", p.handle))
    asm = data.get("assembly") or {}
    p.assembly_module = float(asm.get("module", p.assembly_module))
    p.assembly_door = float(asm.get("door", p.assembly_door))
    p.assembly_drawer = float(asm.get("drawer", p.assembly_drawer))
    p.markup_percent = float(data.get("markup_percent", p.markup_percent))
    p.partner_percent = float(data.get("partner_commission_percent", p.partner_percent))
    return p
