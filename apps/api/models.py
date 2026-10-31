"""Pydantic-модели запросов API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel

class SolveIn(BaseModel):
    product: dict[str, Any]
    shop: str | None = None
    market: str | None = None
    supplier: str | None = None


class ActionIn(BaseModel):
    actions: list[dict[str, Any]]
    commit: bool = False
    strict: bool = False


class VersionIn(BaseModel):
    name: str | None = None


class RestoreIn(BaseModel):
    backup: bool = True


class AuthIn(BaseModel):
    email: str = ""
    password: str = ""
    name: str = ""


class DemoIn(BaseModel):
    pass



class BatchSolveIn(BaseModel):
    products: list[dict[str, Any]]
    shop: str | None = None
    market: str | None = None
    supplier: str | None = None
