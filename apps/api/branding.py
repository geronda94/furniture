"""Брендирование PDF КП: specs/branding.yaml + env-переопределения."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
FILE = ROOT / "specs" / "branding.yaml"

ENV = {
    "company": "QUOTE_COMPANY",
    "phone": "QUOTE_PHONE",
    "email": "QUOTE_EMAIL",
    "site": "QUOTE_SITE",
    "address": "QUOTE_ADDRESS",
    "bank": "QUOTE_BANK",
    "vat": "QUOTE_VAT_ID",
    "logo": "QUOTE_LOGO",
    "note": "QUOTE_NOTE",
}


def load_branding(shop: str | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {}
    try:
        import yaml
        if FILE.exists():
            data = yaml.safe_load(FILE.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001 — брендирование не должно ломать КП
        data = {}
    out = dict(data.get("default") or {})
    if shop:
        out.update((data.get("shops") or {}).get(shop) or {})
    for key, env in ENV.items():
        value = os.getenv(env)
        if value:
            out[key] = value
    if out.get("logo"):
        path = Path(str(out["logo"]))
        out["logo"] = str(path if path.is_absolute() else ROOT / path)
    return out
