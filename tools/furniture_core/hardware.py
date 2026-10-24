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
