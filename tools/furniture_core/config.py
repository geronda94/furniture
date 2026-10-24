"""Параметры цеха и универсальные константы (System 32, фурнитура, листы)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

# ---------- Универсальные константы (System 32 и фурнитура) ----------
SYS32_PITCH = 32.0
SYS32_OFFSET = 37.0          # от передней кромки
SYS32_DIA = 5.0
SYS32_DEPTH = 13.0

HINGE_CUP_DIA = 35.0
HINGE_CUP_OFFSET = {"blum": 22.5, "hettich": 22.0, "gtv": 22.0}
HINGE_EDGE = 90.0            # от торца до центра крайней петли
HINGE_MAX_PITCH = 600.0

CONFIRMAT_PILOT_DIA = 5.0
CONFIRMAT_PILOT_DEPTH = 34.0
CONFIRMAT_FACE_DIA = 7.0
CONFIRMAT_FACE_DEPTH = 13.0

MINIFIX_DIA = 15.0
MINIFIX_DEPTH = 12.5
MINIFIX_OFFSET = 34.0

DOWEL_DIA = 8.0
DOWEL_DEPTH = 12.0

SHEET_W, SHEET_H = 2750.0, 1830.0
SHEET_TRIM = 15.0
KERF = 4.0


@dataclass
class Config:
    t: float = 16.0               # толщина ЛДСП
    t_back: float = 4.0           # толщина ДВП
    edge_front: float = 2.0       # кромка видимая
    edge_inner: float = 0.4       # кромка внутренняя
    gap_side: float = 2.0
    gap_between: float = 3.0
    gap_top: float = 2.0
    gap_bottom: float = 2.0
    hardware: str = "blum"          # бренд петель
    runners: str = "tandem-21"      # id направляющих из specs/hardware.yaml
    sheet_w: float = SHEET_W
    sheet_h: float = SHEET_H
    trim: float = SHEET_TRIM
    kerf: float = KERF
    shelf_setback: float = 20.0   # полка короче глубины
    plinth: float = 80.0          # высота цоколя (служебное)
    frame: str = "inset"          # "inset" вкладная | "overlay" накладная
    mount: str = "floor"          # floor напольный | wall навесной

    # Задняя стенка и верх
    back: str = "dvp"             # dvp | same | cardboard | none
    back_t: float = 4.0           # толщина задней стенки (для cardboard/dvp)
    include_roof: bool = True     # крыша корпуса
    reinforce: str = "auto"       # auto | on | off — царги при отсутствии крыши/задника
    reinforce_h: float = 60.0     # ширина царги (5–7 см)

    # Габариты модуля/кухни (выносятся в UI; значения — стандарт из docs/10)
    corpus_h: float = 720.0       # высота корпуса
    corpus_d: float = 560.0       # глубина корпуса
    plinth_h: float = 100.0       # высота цоколя
    worktop_t: float = 38.0       # толщина столешницы


def load_config(path: str | Path | None) -> Config:
    cfg = Config()
    if not path:
        return cfg
    text = Path(path).read_text(encoding="utf-8")
    data = None
    try:
        import yaml
        data = yaml.safe_load(text)
    except Exception:
        try:
            data = json.loads(text)
        except Exception:
            data = None
    if not isinstance(data, dict):
        return cfg
    for k, v in data.items():
        if hasattr(cfg, k):
            setattr(cfg, k, v)
    return cfg
