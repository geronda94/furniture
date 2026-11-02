"""ИИ-чат: прокси к DeepSeek (OpenAI-совместимый) с инструментами.

Ключ и база — только в env сервера:
  AI_API_KEY / DEEPSEEK_API_KEY
  AI_BASE_URL (по умолчанию https://api.deepseek.com)
  AI_MODEL (по умолчанию deepseek-chat)
Клиент отправляет сообщения и контекст сцены; сервер добавляет системный
промпт, правила и JSON Schema инструментов. Правки проекта выполняет клиент
через /preview и /actions.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import common
from ..ai_tools import COORDS, GUIDE, MODULE_PARAMS, RULES, TOOLS
from ..common import user_or_401

router = APIRouter()


def _key() -> str:
    return (os.getenv("AI_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or "").strip()


def _base() -> str:
    return (os.getenv("AI_BASE_URL") or "https://api.deepseek.com").rstrip("/")


def _model() -> str:
    return os.getenv("AI_MODEL") or "deepseek-chat"


def _tools() -> list[dict[str, Any]]:
    out = []
    for t in TOOLS:
        if not t.get("implemented"):
            continue
        if not t.get("implemented"):
            continue
        out.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description") or t["name"],
                "parameters": t.get("schema") or {"type": "object"},
            },
        })
    return out


class ChatMsg(BaseModel):
    role: str
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    name: str | None = None


class ChatIn(BaseModel):
    messages: list[ChatMsg] = Field(default_factory=list)
    context: dict[str, Any] | None = None


def _system_prompt() -> str:
    params = "; ".join(f"{k} — {v}" for k, v in MODULE_PARAMS.items())
    return (
        "Ты — ИИ-конструктор мебели и помещений внутри CAD-приложения. "
        "Отвечай по-русски, коротко и по делу.\n"
        "Ты умеешь всё, что умеет интерфейс: строить комнату и план, ставить "
        "стены/перегородки, окна/двери, розетки/полки, проектировать мебель "
        "из модулей (габариты, створки, ящики, полки, фасады, материалы, "
        "фурнитура), менять раскладку, проверять и исправлять, управлять "
        "камерой/видом/панелями, открывать и создавать проекты, считать смету "
        "и деталировку.\n"
        "Ты видишь контекст сцены: камера, выделенный объект/деталь, комната, "
        "стены с длинами, модули, декор, материалы, ошибки. Используй его, "
        "не переспрашивай то, что уже есть.\n"
        + COORDS + "\n"
        "Параметры модуля: " + params + ".\n"
        "Любое изменение проекта — только через инструменты. Не выдумывай id, "
        "размеры и артикулы. Изменения попадают в предпросмотр; не утверждай, "
        "что уже применено, пока человек не нажал «Применить».\n"
        "Сначала объясни план одним-двумя предложениями, затем вызывай "
        "инструменты. Если не хватает данных — задай один точный вопрос.\n"
        "Как работать:\n- " + "\n- ".join(GUIDE)
        + "\nПравила проекта:\n- " + "\n- ".join(RULES)
    )


SYSTEM = _system_prompt()


@router.get("/api/ai/status")
def ai_status():
    return {
        "configured": bool(_key()),
        "provider": "deepseek" if "deepseek" in _base() else "openai-compatible",
        "model": _model(),
        "tools": len(_tools()),
    }


@router.post("/api/ai/chat")
def ai_chat(body: ChatIn, request: Request):
    user_or_401(request)
    if not _key():
        raise HTTPException(503, {
            "configured": False,
            "message": "ИИ не настроен: добавьте DEEPSEEK_API_KEY в .env и перезапустите API",
        })
    common.heavy_limit(request, "ai", common.AI_PER_MIN)

    msgs: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM}]
    if body.context:
        raw = json.dumps(body.context, ensure_ascii=False)
        if len(raw) > 24000:
            raw = raw[:24000] + "…"
        msgs.append({
            "role": "system",
            "content": "Контекст сцены (JSON). Если нужны точные размеры/зазоры — они в selection/room/project. Не переспрашивай то, что здесь есть:\n" + raw,
        })
    for m in body.messages[-40:]:
        if m.role not in ("user", "assistant", "tool"):
            continue
        row: dict[str, Any] = {"role": m.role}
        if m.content is not None:
            row["content"] = m.content[:12000]
        else:
            row["content"] = ""
        if m.tool_calls:
            row["tool_calls"] = m.tool_calls[:8]
        if m.tool_call_id:
            row["tool_call_id"] = m.tool_call_id
        if m.name:
            row["name"] = m.name
        msgs.append(row)

    payload = {
        "model": _model(),
        "messages": msgs,
        "tools": _tools(),
        "tool_choice": "auto",
        "temperature": 0.2,
        "max_tokens": int(os.getenv("AI_MAX_TOKENS", "2000")),
    }
    url = _base() + "/chat/completions"
    try:
        with httpx.Client(timeout=float(os.getenv("AI_TIMEOUT", "90"))) as client:
            r = client.post(
                url,
                headers={
                    "Authorization": f"Bearer {_key()}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(502, {
            "configured": True,
            "message": f"Ошибка связи с ИИ: {exc.__class__.__name__}",
        }) from exc
    if r.status_code >= 400:
        text = r.text[:800]
        raise HTTPException(502, {
            "configured": True,
            "message": f"ИИ вернул {r.status_code}",
            "detail": text,
        })
    data = r.json()
    choices = data.get("choices") or []
    if not choices:
        raise HTTPException(502, {"message": "ИИ вернул пустой ответ"})
    msg = choices[0].get("message") or {}
    return {
        "configured": True,
        "model": data.get("model") or _model(),
        "message": {
            "role": "assistant",
            "content": msg.get("content") or "",
            "tool_calls": msg.get("tool_calls") or [],
        },
        "usage": data.get("usage") or {},
    }
