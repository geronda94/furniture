"""HTTP API конструктора: точка сборки роутеров.

Запуск из корня репозитория:
    uvicorn apps.api.main:app --reload --port 8000

Маршруты разложены по `apps/api/routers/`:
* `auth` — регистрация, вход, демо-гость;
* `catalog` — health, каталог, материалы, цех, фурнитура, цены, гайд;
* `solve` — расчёт деталировки/сметы;
* `projects` — проекты, снимки, расстановка, strict-сохранение.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import common
from .routers import ai, auth, catalog, exports, plans, projects, quickstart, solve

app = FastAPI(title="Furniture Constructor API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(catalog.router)
app.include_router(solve.router)
app.include_router(projects.router)
app.include_router(quickstart.router)
app.include_router(exports.router)
app.include_router(ai.router)
app.include_router(plans.router)

__all__ = ["app", "common"]
