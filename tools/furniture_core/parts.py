"""Детали корпуса: размеры, кромка, присадка, сегментация."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .config import (
    CONFIRMAT_PILOT_DEPTH,
    CONFIRMAT_PILOT_DIA,
    Config,
    HINGE_CUP_DIA,
    HINGE_CUP_OFFSET,
    SYS32_DEPTH,
    SYS32_DIA,
    SYS32_OFFSET,
    SYS32_PITCH,
)


@dataclass
class Part:
    name: str
    qty: int
    w: float                     # чистовой по X (гориз.)
    h: float                     # чистовой по Y (верт.)
    material: str = "ЛДСП"
    edges: dict = field(default_factory=dict)   # left/right/top/bottom -> мм
    grain: str = ""              # 'по высоте' | ''
    grain_len: float = 0.0       # длина волокна вдоль длинной оси листа
    front_key: str = ""          # какой торец считать ПЕРЕДНИМ (видимым)
    # тип кромки по сторонам: pvc_2 / pvc_04 / abs_2 / laser_1 / none
    edge_kind: dict = field(default_factory=dict)

    def saw(self):
        """Пильный размер = чистовой минус кромки по сторонам."""
        ex = self.edges.get("left", 0) + self.edges.get("right", 0)
        ey = self.edges.get("top", 0) + self.edges.get("bottom", 0)
        return (round(self.w - ex, 1), round(self.h - ey, 1))

    def edge_summary(self):
        order = ["left", "top", "right", "bottom"]
        ru = {"left": "лев", "top": "верх", "right": "прав", "bottom": "низ"}
        out = []
        for k in order:
            v = self.edges.get(k, 0)
            label = "ПЕРЕД" if k == self.front_key else ru[k]
            out.append(f"{label}{v:g}" if v else f"{label}-")
        return " ".join(out)


def hinge_count(h: float) -> int:
    if h <= 900:
        return 2
    if h <= 1600:
        return 3
    if h <= 2000:
        return 4
    return 5


def gen_parts(W, H, D, n_shelves, n_doors, roof, cfg: Config):
    t = cfg.t
    ef = cfg.edge_front
    parts = []

    if roof == "overlay":
        side_h = H - t
        top_w = W
        top_edges = {"bottom": ef}
    else:  # inset
        side_h = H
        top_w = W - 2 * t
        top_edges = {"bottom": ef}

    # Боковины: front edge — вертикальный торец (right), влияет на глубину
    parts.append(Part("Боковина", 2, D, side_h, "ЛДСП",
                      {"right": ef}, "по высоте", grain_len=side_h))
    parts.append(Part("Крыша", 1, top_w, D, "ЛДСП", dict(top_edges)))
    parts.append(Part("Дно", 1, top_w, D, "ЛДСП", dict(top_edges)))
    parts.append(Part("Полка съёмная", n_shelves,
                      round(W - 2 * t - 3, 1), round(D - cfg.shelf_setback, 1),
                      "ЛДСП", {"bottom": ef}))
    parts.append(Part("Задняя стенка", 1, W - 2, H - 2, "ДВП", {}))

    if n_doors > 0:
        fw = (W - 2 * cfg.gap_side - (n_doors - 1) * cfg.gap_between) / n_doors
        fh = H - cfg.gap_top - cfg.gap_bottom
        parts.append(Part("Фасад", n_doors, round(fw, 1), round(fh, 1),
                          "ЛДСП", {"left": ef, "right": ef, "top": ef,
                                   "bottom": ef},
                          "по высоте", grain_len=round(fh, 1)))

    return parts


def gen_drilling(W, H, D, n_shelves, n_doors, roof, parts, cfg: Config):
    """Список отверстий: {деталь, грань, x, y, dia, depth, note}."""
    holes = []

    # System 32 на боковинах: 2 ряда по глубине (37 и D-37), шаг 32 по высоте
    ys = []
    y = SYS32_PITCH
    while y <= H - SYS32_PITCH + 0.1:
        ys.append(y)
        y += SYS32_PITCH
    for row_x in (SYS32_OFFSET, D - SYS32_OFFSET):
        for y in ys:
            holes.append({"part": "Боковина", "face": "внутр. пласть",
                          "x": round(row_x, 1), "y": round(y, 1),
                          "dia": SYS32_DIA, "depth": SYS32_DEPTH,
                          "note": "System 32 / полкодержатель"})

    # Конфирматы крыша/дно ↔ боковина: пилот Ø5 в торец, 2 на соединение
    for y in (SYS32_OFFSET, D - SYS32_OFFSET):
        for part in ("Крыша", "Дно"):
            holes.append({"part": part, "face": "передний/задний торец",
                          "x": round(y, 1), "y": 0, "dia": CONFIRMAT_PILOT_DIA,
                          "depth": CONFIRMAT_PILOT_DEPTH,
                          "note": "Конфирмат 7×50 (торец)"})

    # Петли на фасадах
    if n_doors > 0:
        fh = H - cfg.gap_top - cfg.gap_bottom
        off = HINGE_CUP_OFFSET.get(cfg.hardware, 22.5)
        n = hinge_count(fh)
        holes.append({"part": "Фасад", "face": "внутр. пласть",
                      "x": off, "y": 0, "dia": HINGE_CUP_DIA, "depth": 12.5,
                      "note": f"Петли {cfg.hardware}: {n} шт/фасад, "
                              f"отступ {off} мм от торца"})

    return holes


def merge_parts(parts: list[Part]) -> list[Part]:
    """Свести одинаковые детали (имя, размер, материал, кромка, текстура)."""
    out: list[Part] = []
    index: dict[tuple, Part] = {}
    for p in parts:
        key = (
            p.name, p.material, round(p.w, 1), round(p.h, 1),
            tuple(sorted((k, round(v, 2)) for k, v in p.edges.items())),
            tuple(sorted(p.edge_kind.items())),
            p.grain, round(p.grain_len, 1), p.front_key,
        )
        found = index.get(key)
        if found is not None:
            found.qty += p.qty
            continue
        copy = Part(p.name, p.qty, p.w, p.h, p.material, dict(p.edges),
                    p.grain, p.grain_len, p.front_key, dict(p.edge_kind))
        index[key] = copy
        out.append(copy)
    return out


def segment(name, length, height, cfg: Config, front_key="", edges=None,
            material="ЛДСП", max_len=None):
    """Длинную деталь (цоколь, столешница) режем сегментами по формату листа."""
    max_len = max_len or (cfg.sheet_w - 2 * cfg.trim)
    n = max(1, int(math.ceil(length / max_len)))
    seg = length / n
    out = []
    for i in range(n):
        nm = f"{name} ({i + 1}/{n})" if n > 1 else name
        out.append(Part(nm, 1, round(seg, 1), height, material,
                        dict(edges or {}), front_key=front_key))
    return out


def _edge_type(types, value):
    """Найти тип кромки по id или толщине."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        for t in types:
            if abs(t.thickness - float(value)) < 1e-6:
                return t
        return None
    sid = str(value)
    for t in types:
        if t.id == sid:
            return t
    for t in types:
        if str(t.thickness) == sid:
            return t
    return None


def _side_key(part: Part, key: str) -> str | None:
    """Семантические стороны: front/back → локальный ключ стороны."""
    k = str(key)
    if k in ("left", "right", "top", "bottom"):
        return k
    if k in ("front", "перед", "ПЕРЕД"):
        return part.front_key or None
    if k in ("back", "зад"):
        opposite = {"left": "right", "right": "left",
                    "top": "bottom", "bottom": "top"}
        return opposite.get(part.front_key or "")
    return None


def apply_edge_policy(parts: list[Part], policy: dict | None,
                      types: list) -> list[Part]:
    """Применить правила/переопределения кромки к готовым деталям.

    policy:
      visible: id/толщина видимой кромки (перекрасить все видимые)
      hidden:  id/толщина скрытой кромки
      byPart:  { "Полка": { "front": "pvc_2", "top": "none" }, ... }
               ключ может заканчиваться на * (префикс);
               значение: auto | none | id типа | толщина

    Функция не меняет геометрию — только карту кромки до раскроя.
    """
    if not isinstance(policy, dict) or not parts:
        return parts
    types = types or []
    visible = _edge_type(types, policy.get("visible"))
    hidden = _edge_type(types, policy.get("hidden"))
    by_part = policy.get("byPart") or {}

    def matches(name: str, key: str) -> bool:
        return name == key or (key.endswith("*") and name.startswith(key[:-1]))

    for part in parts:
        # 1) глобальная замена по категории видимости
        for side, thick in list(part.edges.items()):
            if not thick:
                continue
            target = visible if float(thick) >= 1.5 else hidden
            if target is not None:
                if target.id == "none" or target.thickness <= 0:
                    part.edges.pop(side, None)
                    part.edge_kind.pop(side, None)
                else:
                    part.edges[side] = float(target.thickness)
                    part.edge_kind[side] = target.id
        # 2) переопределения по детали
        rules: dict = {}
        for key, rule in by_part.items():
            if isinstance(rule, dict) and matches(part.name, str(key)):
                rules.update(rule)
        for key, value in rules.items():
            side = _side_key(part, key)
            if side is None:
                continue
            if value in (None, "auto", "", True):
                continue
            if value in ("none", "off", False, 0):
                part.edges.pop(side, None)
                part.edge_kind.pop(side, None)
                continue
            et = _edge_type(types, value)
            if et is None:
                continue
            if et.id == "none" or et.thickness <= 0:
                part.edges.pop(side, None)
                part.edge_kind.pop(side, None)
            else:
                part.edges[side] = float(et.thickness)
                part.edge_kind[side] = et.id
    return parts
