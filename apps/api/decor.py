"""Справочник декора и предметов интерьера (specs/decor.yaml).

Единый источник данных для API, ИИ-каталога инструментов и веб-клиента
(последний получает сгенерированный TS-файл по tools/gen_decor_catalog.py).
Экземпляры предметов проекта живут в projects.doc.props[] и здесь не хранятся.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / "specs" / "decor.yaml"


@lru_cache(maxsize=1)
def decor_catalog() -> dict[str, Any]:
    data = yaml.safe_load(CATALOG_PATH.read_text(encoding="utf-8")) or {}
    if not data.get("groups") or not data.get("types") or not data.get("presets"):
        raise RuntimeError(f"{CATALOG_PATH}: нужны groups, types и presets")
    return data


def decor_groups() -> list[dict[str, str]]:
    return list(decor_catalog().get("groups") or [])


def decor_types() -> list[str]:
    return list(decor_catalog().get("types") or [])


def decor_presets() -> list[dict[str, Any]]:
    return list(decor_catalog().get("presets") or [])
