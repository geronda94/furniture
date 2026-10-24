"""Ядро мебельного движка: правила, деталировка, присадка, раскрой, сцена.

Публичный API:
    from furniture_core import Config, load_config, solve
"""
from .config import Config, load_config
from .cutting import pack, svg_cutting, validate
from .dxf import facade_dxf, parts_dxf, render
from .kitchen import Section, gen_kitchen, parse_sections, scene3d
from .outputs import write_outputs
from .parts import Part, gen_drilling, gen_parts, hinge_count, segment
from .solve import DEFAULT_MATERIALS, solve

__all__ = [
    "Config", "load_config", "solve", "DEFAULT_MATERIALS",
    "Section", "parse_sections", "gen_kitchen", "scene3d",
    "Part", "gen_parts", "gen_drilling", "hinge_count", "segment",
    "pack", "svg_cutting", "validate", "write_outputs",
    "facade_dxf", "parts_dxf", "render",
]
