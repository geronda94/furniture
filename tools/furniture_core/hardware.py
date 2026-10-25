"""Каталог фурнитуры (данные из specs/hardware.yaml)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "specs" / "hardware.yaml"
EDGE_TYPES_PATH = Path(__file__).resolve().parents[2] / "specs" / "edge-types.yaml"


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
    # типовая схема отверстий из каталога (иначе — по шаблону производителя)
    template: bool = False
    body_holes: list[dict] = field(default_factory=list)
    box_holes: list[dict] = field(default_factory=list)

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
            "template": self.template,
            "body_holes": self.body_holes,
            "box_holes": self.box_holes,
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
    plate_pitch: float = 32.0
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
            "plate_pitch": self.plate_pitch,
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
    # правила положения
    door_margin: float = 60.0    # от края открывания
    door_top: float = 60.0       # от верхней кромки створки
    drawer_center: bool = True
    two_above_width: float = 0.0  # 0 — всегда одна ручка

    def as_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "brand": self.brand,
            "price": self.price, "centers": self.centers,
            "mount": self.mount, "hole_dia": self.hole_dia,
            "hole_depth": self.hole_depth, "kind": self.kind,
            "door_margin": self.door_margin, "door_top": self.door_top,
            "drawer_center": self.drawer_center,
            "two_above_width": self.two_above_width,
        }


@dataclass
class Fastener:
    id: str
    name: str
    kind: str = "confirmat"
    face_dia: float = 7.0
    face_depth: float = 13.0
    pilot_dia: float = 5.0
    pilot_depth: float = 34.0
    head_dia: float = 10.0
    per_joint: int = 2
    visibility: str = "hidden"
    price_key: str = "confirmat"
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "kind": self.kind,
            "face_dia": self.face_dia, "face_depth": self.face_depth,
            "pilot_dia": self.pilot_dia, "pilot_depth": self.pilot_depth,
            "head_dia": self.head_dia, "per_joint": self.per_joint,
            "visibility": self.visibility, "price_key": self.price_key,
            "note": self.note,
        }


@dataclass
class ShelfSupport:
    id: str
    name: str
    kind: str = "pin"
    hole_dia: float = 5.0
    depth: float = 13.0
    per_side: int = 2
    x_mode: str = "front_rear"    # front_rear | front | rear | center
    offset: float = 37.0
    price_key: str = "shelf_pin"
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "kind": self.kind,
            "hole_dia": self.hole_dia, "depth": self.depth,
            "per_side": self.per_side, "x_mode": self.x_mode,
            "offset": self.offset, "price_key": self.price_key,
            "note": self.note,
        }


@dataclass
class GasStrut:
    id: str
    name: str
    brand: str = ""
    force_n: float = 20.0
    door_weight_max: float = 4.5
    body_offset_x: float = 95.0       # от передней кромки боковины
    body_offset_top: float = 60.0     # от верхней кромки боковины
    door_offset_x: float = 55.0       # от петлевой стороны створки
    door_offset_bottom: float = 70.0  # от нижней кромки створки
    hole_dia: float = 4.0
    hole_depth: float = 12.0
    template: bool = False
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "brand": self.brand,
            "force_n": self.force_n, "door_weight_max": self.door_weight_max,
            "body_offset_x": self.body_offset_x,
            "body_offset_top": self.body_offset_top,
            "door_offset_x": self.door_offset_x,
            "door_offset_bottom": self.door_offset_bottom,
            "hole_dia": self.hole_dia, "hole_depth": self.hole_depth,
            "template": self.template, "note": self.note,
        }


@dataclass
class LegMount:
    id: str
    name: str
    kind: str = "plate"
    plate: float = 0.0
    hole_dia: float = 4.5
    depth: float = 16.0
    holes: list[dict] = field(default_factory=list)
    template: bool = True
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "kind": self.kind,
            "plate": self.plate, "hole_dia": self.hole_dia,
            "depth": self.depth, "holes": self.holes,
            "template": self.template, "note": self.note,
        }


@dataclass
class EdgeType:
    id: str
    name: str
    thickness: float = 2.0
    color: str = "#ff8a3d"
    price_key: str = "pvc_2"
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "thickness": self.thickness,
            "color": self.color, "price_key": self.price_key,
            "note": self.note,
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
            door_margin=float(row.get("door_margin", 60.0)),
            door_top=float(row.get("door_top", 60.0)),
            drawer_center=bool(row.get("drawer_center", True)),
            two_above_width=float(row.get("two_above_width", 0.0)),
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
            plate_pitch=float(row.get("plate_pitch", 32.0)),
            edge_margin=float(row.get("edge_margin", 90.0)),
            max_pitch=float(row.get("max_pitch", 600.0)),
        ))
    return out or DEFAULT_HINGES


def find_hinge(hinges: list[Hinge], brand: str | None) -> Hinge:
    for h in hinges:
        if h.brand_key == brand or h.id == brand:
            return h
    return hinges[0] if hinges else DEFAULT_HINGES[0]


def load_fasteners(path: str | Path | None = None) -> list[Fastener]:
    data = _read_hardware(path)
    rows = data.get("fasteners") if isinstance(data, dict) else None
    out: list[Fastener] = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        out.append(Fastener(
            id=str(row["id"]),
            name=str(row.get("name", row["id"])),
            kind=str(row.get("kind", "confirmat")),
            face_dia=float(row.get("face_dia", 7.0)),
            face_depth=float(row.get("face_depth", 13.0)),
            pilot_dia=float(row.get("pilot_dia", 5.0)),
            pilot_depth=float(row.get("pilot_depth", 34.0)),
            head_dia=float(row.get("head_dia", 10.0)),
            per_joint=int(row.get("per_joint", 2)),
            visibility=str(row.get("visibility", "hidden")),
            price_key=str(row.get("price_key", "confirmat")),
            note=str(row.get("note", "")),
        ))
    return out or [Fastener("confirmat", "Конфирмат 7×50")]


def find_fastener(items: list[Fastener], fid: str | None) -> Fastener:
    for f in items:
        if f.id == fid:
            return f
    return items[0]


def load_shelf_supports(path: str | Path | None = None) -> list[ShelfSupport]:
    data = _read_hardware(path)
    rows = data.get("shelf_supports") if isinstance(data, dict) else None
    out: list[ShelfSupport] = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        out.append(ShelfSupport(
            id=str(row["id"]),
            name=str(row.get("name", row["id"])),
            kind=str(row.get("kind", "pin")),
            hole_dia=float(row.get("hole_dia", 5.0)),
            depth=float(row.get("depth", 13.0)),
            per_side=int(row.get("per_side", 2)),
            x_mode=str(row.get("x_mode", "front_rear")),
            offset=float(row.get("offset", 37.0)),
            price_key=str(row.get("price_key", "shelf_pin")),
            note=str(row.get("note", "")),
        ))
    return out or [ShelfSupport("system32", "Полкодержатель System 32")]


def find_shelf_support(items: list[ShelfSupport], sid: str | None) -> ShelfSupport:
    for s in items:
        if s.id == sid:
            return s
    return items[0]


def load_gas_struts(path: str | Path | None = None) -> list[GasStrut]:
    data = _read_hardware(path)
    rows = data.get("gas_struts") if isinstance(data, dict) else None
    out: list[GasStrut] = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        out.append(GasStrut(
            id=str(row["id"]),
            name=str(row.get("name", row["id"])),
            brand=str(row.get("brand", "")),
            force_n=float(row.get("force_n", 20.0)),
            door_weight_max=float(row.get("door_weight_max", 4.5)),
            body_offset_x=float(row.get("body_offset_x", 95.0)),
            body_offset_top=float(row.get("body_offset_top", 60.0)),
            door_offset_x=float(row.get("door_offset_x", 55.0)),
            door_offset_bottom=float(row.get("door_offset_bottom", 70.0)),
            hole_dia=float(row.get("hole_dia", 4.0)),
            hole_depth=float(row.get("hole_depth", 12.0)),
            template=bool(row.get("template", False)),
            note=str(row.get("note", "")),
        ))
    return out


def find_gas_strut(items: list[GasStrut], sid: str | None) -> GasStrut | None:
    if not sid:
        return None
    for s in items:
        if s.id == sid:
            return s
    return None


def load_legs(path: str | Path | None = None) -> list[LegMount]:
    data = _read_hardware(path)
    rows = data.get("legs") if isinstance(data, dict) else None
    out: list[LegMount] = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        out.append(LegMount(
            id=str(row["id"]),
            name=str(row.get("name", row["id"])),
            kind=str(row.get("kind", "plate")),
            plate=float(row.get("plate", 0.0)),
            hole_dia=float(row.get("hole_dia", 4.5)),
            depth=float(row.get("depth", 16.0)),
            holes=[h for h in (row.get("holes") or []) if isinstance(h, dict)],
            template=bool(row.get("template", True)),
            note=str(row.get("note", "")),
        ))
    return out


def find_leg(items: list[LegMount], leg_id: str | None) -> LegMount | None:
    if not leg_id:
        return items[0] if items else None
    for l in items:
        if l.id == leg_id:
            return l
    return items[0] if items else None


def load_edge_types(path: str | Path | None = None) -> list[EdgeType]:
    p = Path(path) if path else EDGE_TYPES_PATH
    data: dict = {}
    if p.exists():
        try:
            text = p.read_text(encoding="utf-8")
            try:
                import yaml
                data = yaml.safe_load(text) or {}
            except Exception:
                data = json.loads(text) or {}
        except Exception:
            data = {}
    rows = data.get("types") if isinstance(data, dict) else None
    out: list[EdgeType] = []
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        out.append(EdgeType(
            id=str(row["id"]),
            name=str(row.get("name", row["id"])),
            thickness=float(row.get("thickness", 2.0)),
            color=str(row.get("color", "#ff8a3d")),
            price_key=str(row.get("price_key", "pvc_2")),
            note=str(row.get("note", "")),
        ))
    if out:
        return out
    return [
        EdgeType("pvc_2", "ПВХ 2 мм", 2.0, "#ff8a3d", "pvc_2"),
        EdgeType("pvc_04", "ПВХ 0.4 мм", 0.4, "#4ea3ff", "pvc_04"),
        EdgeType("none", "Без кромки", 0.0, "#8a8f96", "none"),
    ]


def edge_type_for(types: list[EdgeType], thickness: float) -> EdgeType:
    for t in types:
        if abs(t.thickness - float(thickness)) < 1e-6:
            return t
    for t in types:
        if t.id == "none" and not thickness:
            return t
    return types[0]


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
            template=bool(row.get("template", False)),
            body_holes=[h for h in (row.get("body_holes") or [])
                        if isinstance(h, dict)],
            box_holes=[h for h in (row.get("box_holes") or [])
                       if isinstance(h, dict)],
        ))
    return out or [DEFAULT_RUNNER]


def find_runner(runners: list[Runner], runner_id: str | None) -> Runner:
    for r in runners:
        if r.id == runner_id:
            return r
    return runners[0] if runners else DEFAULT_RUNNER
