"""Каталог фурнитуры (данные из specs/hardware.yaml)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "specs" / "hardware.yaml"


@dataclass
class Runner:
    id: str
    name: str
    side_gap: float = 21.0
    lengths: list[float] = field(default_factory=lambda: [500.0])
    box_height: float = 150.0
    # насколько борта ящика выше передней/задней стенки (скрытые направляющие)
    side_extra: float = 0.0
    brand: str = ""
    type: str = "hidden"
    note: str = ""

    def length_for(self, depth: float) -> float:
        """Ближайший номинал направляющей, влезающий в глубину корпуса."""
        avail = max(50.0, depth - 20.0)
        fit = [l for l in self.lengths if l <= avail]
        if fit:
            return max(fit)
        return min(self.lengths) if self.lengths else avail

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "brand": self.brand,
            "type": self.type,
            "side_gap": self.side_gap,
            "lengths": self.lengths,
            "box_height": self.box_height,
            "side_extra": self.side_extra,
            "note": self.note,
        }


@dataclass
class Hinge:
    id: str
    name: str
    brand: str = ""
    brand_key: str = "blum"
    cup_dia: float = 35.0
    cup_depth: float = 12.5
    cup_offset: float = 22.5
    plate_offset: float = 21.0
    edge_margin: float = 90.0
    max_pitch: float = 600.0

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "brand": self.brand,
            "brand_key": self.brand_key,
            "cup_dia": self.cup_dia,
            "cup_depth": self.cup_depth,
            "cup_offset": self.cup_offset,
            "plate_offset": self.plate_offset,
            "edge_margin": self.edge_margin,
            "max_pitch": self.max_pitch,
        }


@dataclass
class Handle:
    id: str
    name: str
    brand: str = ""
    price: float = 150.0
    centers: float = 128.0
    mount: str = "through"       # through | from_inside | profile
    hole_dia: float = 5.0
    hole_depth: float = 13.0
    kind: str = "bar"

    def as_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "brand": self.brand,
            "price": self.price, "centers": self.centers,
            "mount": self.mount, "hole_dia": self.hole_dia,
            "hole_depth": self.hole_depth, "kind": self.kind,
        }


DEFAULT_HANDLES = [
    Handle("bar-128", "Ручка-скоба 128 мм", "generic", 150.0, 128.0),
    Handle("bar-160", "Ручка-скоба 160 мм", "generic", 170.0, 160.0),
    Handle("rail-192", "Рейлинг 192 мм", "generic", 210.0, 192.0),
    Handle("knob-30", "Ручка-кнопка 30 мм", "generic", 90.0, 0.0),
    Handle("profile-04", "Профиль-ручка 4 м", "generic", 780.0, 0.0,
           mount="profile", kind="profile"),
]


def load_handles(path: str | Path | None = None) -> list[Handle]:
    data = _read_hardware(path)
    rows = data.get("handles") if isinstance(data, dict) else None
    out: list[Handle] = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        out.append(Handle(
            id=str(row["id"]),
            name=str(row.get("name", row["id"])),
            brand=str(row.get("brand", "")),
            price=float(row.get("price", 150.0)),
            centers=float(row.get("centers", 0.0)),
            mount=str(row.get("mount", "through")),
            hole_dia=float(row.get("hole_dia", 5.0)),
            hole_depth=float(row.get("hole_depth", 13.0)),
            kind=str(row.get("kind", "bar")),
        ))
    return out or DEFAULT_HANDLES


def find_handle(handles: list[Handle], handle_id: str | None) -> Handle:
    for h in handles:
        if h.id == handle_id:
            return h
    return handles[0] if handles else DEFAULT_HANDLES[0]


DEFAULT_HINGES = [
    Hinge("blum-clip-top", "CLIP top BLUMOTION 110°", "Blum", "blum"),
    Hinge("hettich-intermat", "Intermat 9936", "Hettich", "hettich", cup_offset=22.0),
    Hinge("gtv-110", "Петля 110° с доводчиком", "GTV", "gtv", cup_offset=22.0),
]


def _read_hardware(path: str | Path | None = None) -> dict:
    p = Path(path) if path else DEFAULT_PATH
    if not p.exists():
        return {}
    try:
        text = p.read_text(encoding="utf-8")
        try:
            import yaml
            return yaml.safe_load(text) or {}
        except Exception:
            return json.loads(text) or {}
    except Exception:
        return {}


def load_hinges(path: str | Path | None = None) -> list[Hinge]:
    data = _read_hardware(path)
    rows = data.get("hinges") if isinstance(data, dict) else None
    out: list[Hinge] = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        out.append(Hinge(
            id=str(row["id"]),
            name=str(row.get("name", row["id"])),
            brand=str(row.get("brand", "")),
            brand_key=str(row.get("brand_key", "blum")),
            cup_dia=float(row.get("cup_dia", 35.0)),
            cup_depth=float(row.get("cup_depth", 12.5)),
            cup_offset=float(row.get("cup_offset", 22.5)),
            plate_offset=float(row.get("plate_offset", 21.0)),
            edge_margin=float(row.get("edge_margin", 90.0)),
            max_pitch=float(row.get("max_pitch", 600.0)),
        ))
    return out or DEFAULT_HINGES


def find_hinge(hinges: list[Hinge], brand: str | None) -> Hinge:
    for h in hinges:
        if h.brand_key == brand or h.id == brand:
            return h
    return hinges[0] if hinges else DEFAULT_HINGES[0]


DEFAULT_RUNNER = Runner(
    id="tandem-21",
    name="Скрытые TANDEM plus BLUMOTION 560H",
    brand="Blum",
    side_gap=21.0,
    lengths=[250, 270, 300, 350, 400, 450, 500, 550],
    side_extra=10.0,
)


def load_runners(path: str | Path | None = None) -> list[Runner]:
    p = Path(path) if path else DEFAULT_PATH
    if not p.exists():
        return [DEFAULT_RUNNER]
    try:
        text = p.read_text(encoding="utf-8")
        try:
            import yaml
            data = yaml.safe_load(text)
        except Exception:
            data = json.loads(text)
    except Exception:
        return [DEFAULT_RUNNER]
    if not isinstance(data, dict):
        return [DEFAULT_RUNNER]
    out: list[Runner] = []
    for row in data.get("drawer_runners", []) or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        out.append(Runner(
            id=str(row["id"]),
            name=str(row.get("name", row["id"])),
            side_gap=float(row.get("side_gap", 21.0)),
            lengths=[float(x) for x in (row.get("lengths") or [500])],
            box_height=float(row.get("box_height", 150.0)),
            side_extra=float(row.get("side_extra", 0.0)),
            brand=str(row.get("brand", "")),
            type=str(row.get("type", "hidden")),
            note=str(row.get("note", "")),
        ))
    return out or [DEFAULT_RUNNER]


def find_runner(runners: list[Runner], runner_id: str | None) -> Runner:
    for r in runners:
        if r.id == runner_id:
            return r
    return runners[0] if runners else DEFAULT_RUNNER
