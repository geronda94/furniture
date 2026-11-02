#!/usr/bin/env python3
"""API smoke/regression: solve, catalog, project actions, versions.

    python3 tests/api.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.main import app  # noqa: E402
from apps.api import main as api_main  # noqa: E402

SCHEMA = "furniture/project@0"


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"{'ok  ' if cond else 'FAIL'}   {name:<34} {detail}")
    return cond


def project(name: str) -> dict:
    return {
        "schema": SCHEMA,
        "name": name,
        "shop": "shop-ro-bucuresti",
        "market": "ro",
        "supplier": "generic",
        "room": {"w": 3600, "d": 2800, "h": 2700, "openings": []},
        "instances": [],
        "folders": [],
        "materials": {},
        "globals": {"t": 16, "gapBetween": 3, "autoApply": True},
        "views": [],
    }


def main() -> int:
    c = TestClient(app)
    ok = True

    # Без сессии проекты закрыты.
    anon = TestClient(app)
    ok &= check("auth: анонимный список проектов закрыт",
                anon.get("/api/projects").status_code == 401)

    email = f"api-{int(time.time() * 1000)}@example.test"
    r = c.post("/api/auth/register", json={
        "email": email, "password": "test-pass-123", "name": "API Тест",
    })
    ok &= check("auth: регистрация", r.status_code == 200
                and r.json().get("user", {}).get("email") == email)
    ok &= check("auth: сессия", c.get("/api/auth/me").json().get("user") is not None)

    r = c.get("/api/health")
    ok &= check("health", r.status_code == 200 and r.json().get("ok") is True)

    # Rate limit тяжёлых эндпоинтов: бюджет на пользователя, порог из env.
    limits = api_main.common
    prev_solve = limits.SOLVE_PER_MIN
    limits.SOLVE_PER_MIN = 2
    limits._RATE.clear()
    probe = {"product": {"product": "base-cabinet",
                         "params": {"W": 800, "H": 720, "D": 560}}}
    codes = [c.post("/api/solve", json=probe).status_code for _ in range(3)]
    retry = c.post("/api/solve", json=probe).headers.get("Retry-After")
    limits.SOLVE_PER_MIN = prev_solve
    limits._RATE.clear()
    ok &= check("rate limit: solve", codes == [200, 200, 429], str(codes))
    ok &= check("rate limit: Retry-After", retry == "60", str(retry))

    r = c.post("/api/solve", json={"product": {
        "product": "base-cabinet",
        "params": {"W": 800, "H": 720, "D": 560, "doors": 2,
                   "hardware": "hettich", "gapSide": 1.5},
    }})
    body = r.json()
    ok &= check("solve", r.status_code == 200 and not body["validation"]["errors"])
    ok &= check("solve: петли по бренду",
                body.get("hardware", {}).get("hinge", {}).get("brand_key") == "hettich")
    ok &= check("solve: постформинг без кромки 2 мм",
                all(b["edge"].count("2") == 0
                    for b in body["bom"] if b["name"] == "Столешница"))

    r = c.post("/api/solve/batch", json={"products": [
        {"id": "a", "product": "base-cabinet",
         "params": {"W": 600, "H": 720, "D": 560, "doors": 1}},
        {"id": "b", "product": "base-cabinet",
         "params": {"W": 800, "H": 720, "D": 560, "doors": 2}},
        {"id": "bad", "product": "base-cabinet", "params": {"W": -5}},
    ]})
    batch = r.json().get("results", [])
    ok &= check("solve/batch: несколько модулей",
                r.status_code == 200 and len(batch) == 3
                and batch[0].get("result", {}).get("dims", {}).get("outer", {}).get("H_total") == 858)
    ok &= check("solve/batch: ошибка одного не ломает остальные",
                "result" in batch[2] or "error" in batch[2])

    r = c.get("/api/hardware")
    hw = r.json()
    ok &= check("hardware: петли, направляющие, ручки",
                r.status_code == 200 and len(hw.get("hinges", [])) >= 3
                and len(hw.get("drawer_runners", [])) >= 3
                and len(hw.get("handles", [])) >= 3)
    ok &= check("hardware: крепёж, полкодержатели, патроны",
                len(hw.get("fasteners", [])) >= 3
                and len(hw.get("shelf_supports", [])) >= 3
                and len(hw.get("gas_struts", [])) >= 1
                and len(hw.get("legs", [])) >= 3
                and len(hw.get("edge_types", [])) >= 3,
                str(list(hw.keys())))

    r = c.get("/api/pricing/options")
    po = r.json()
    ok &= check("pricing: рынки/цеха/поставщики",
                r.status_code == 200 and len(po.get("markets", [])) >= 2
                and len(po.get("shops", [])) >= 2
                and len(po.get("suppliers", [])) >= 3,
                str(po.get("default")))
    ok &= check("pricing: активный прайс",
                (po.get("active") or {}).get("currency") == "RON",
                str((po.get("active") or {}).get("currency")))

    r = c.post("/api/solve", json={
        "market": "eu", "supplier": "blum",
        "product": {"product": "base-cabinet", "params": {
            "W": 800, "H": 720, "D": 560, "doors": 2,
            "fastener": "minifix", "shelfSupport": "lock-pin",
        }},
    })
    eu = r.json()
    ok &= check("solve: рынок EU / поставщик Blum",
                r.status_code == 200 and eu["cost"]["currency"] == "EUR"
                and eu["cost"]["supplier"] == "blum",
                f'{eu.get("cost", {}).get("currency")}/'
                f'{eu.get("cost", {}).get("supplier")}')
    ok &= check("solve: присадка из каталога",
                any(o["kind"] == "fastener_face" and o["dia"] == 15
                    for o in eu.get("operations", []))
                and eu["hardware_plan"]["shelf_support_id"] == "lock-pin")
    ok &= check("solve: разметка опор",
                r.json().get("hardware_plan", {}).get("leg_holes", 0) > 0,
                str(r.json().get("hardware_plan", {}).get("leg_holes")))
    ok &= check("solve: соединения и саморезы",
                bool(eu["hardware_plan"].get("joints"))
                and "screws" in eu["hardware_plan"],
                str(eu["hardware_plan"].get("joints", [])[:1]))

    r = c.post("/api/solve", json={
        "product": {"product": "base-cabinet", "params": {
            "W": 800, "H": 720, "D": 560, "doors": 2,
            "hiddenFasteners": True,
            "edges": {"visible": "abs_2",
                      "byPart": {"Полка": {"front": "none"}}},
        }},
    })
    adv = r.json()
    ok &= check("solve: скрытый крепёж",
                all(j["fastener_id"] == "minifix"
                    for j in adv["hardware_plan"]["joints"]))
    shelf = next(b for b in adv["bom"] if b["name"] == "Полка")
    ok &= check("solve: переопределение кромки",
                "ПЕРЕД-" in shelf["edge"],
                shelf["edge"])
    roof = next(e for e in adv["edge_plan"] if e["part"] == "Крыша")
    ok &= check("solve: тип кромки ABS",
                all(v["type"] == "abs_2" for v in roof["sides"].values()))

    pid = f"test-api-{int(time.time() * 1000):x}"
    try:
        r = c.put(f"/api/projects/{pid}", json=project("API тест"))
        ok &= check("project: create", r.status_code == 200)

        # Сохранение тоже под лимитом: второй PUT при пороге 1 — 429.
        prev_save = limits.SAVE_PER_MIN
        limits.SAVE_PER_MIN = 1
        limits._RATE.clear()
        first = c.put(f"/api/projects/{pid}", json=project("API тест")).status_code
        second = c.put(f"/api/projects/{pid}", json=project("API тест")).status_code
        limits.SAVE_PER_MIN = prev_save
        limits._RATE.clear()
        ok &= check("rate limit: PUT", [first, second] == [200, 429],
                    f"{first}/{second}")

        # Второй пользователь не видит и не меняет чужой проект.
        other = TestClient(app)
        other_email = f"other-{int(time.time() * 1000)}@example.test"
        r2 = other.post("/api/auth/register", json={
            "email": other_email, "password": "test-pass-123", "name": "Другой",
        })
        ok &= check("auth: второй пользователь", r2.status_code == 200)
        ok &= check("auth: чужой проект закрыт",
                    other.get(f"/api/projects/{pid}").status_code == 403)
        ok &= check("auth: чужой PUT закрыт",
                    other.put(f"/api/projects/{pid}",
                              json=project("Чужой")).status_code == 403)

        r = c.post(f"/api/projects/{pid}/actions", json={
            "actions": [{"op": "add_instance", "preset": "base800"}],
            "commit": False,
        })
        ok &= check("actions: preview add_instance",
                    r.status_code == 200 and r.json()["committed"] is False)
        doc = r.json()["project"]
        ok &= check("actions: модуль добавлен",
                    len(doc.get("instances", [])) == 1)
        inst = doc["instances"][0]
        ok &= check("actions: глобальная толщина унаследована",
                    inst["params"].get("t") == 16)

        st = c.get("/api/ai/status")
        stj = st.json()
        ok &= check("ai: status", st.status_code == 200
                    and "configured" in stj and "model" in stj,
                    f'configured={stj.get("configured")}')
        if not stj.get("configured"):
            r = c.post("/api/ai/chat", json={
                "messages": [{"role": "user", "content": "привет"}],
            })
            ok &= check("ai: chat без ключа — 503", r.status_code == 503)
        tools = c.get("/api/ai/tools")
        tj = tools.json()
        ok &= check("ai: tools endpoint",
                    tools.status_code == 200
                    and any(t["name"] == "add_module" for t in tj.get("tools", []))
                    and any(t["kind"] == "client" for t in tj.get("tools", [])),
                    f'{len(tj.get("tools", []))} инструментов')

        before_count = len(c.get(f"/api/projects/{pid}").json()
                             .get("instances", []))
        r = c.post(f"/api/projects/{pid}/preview", json={
            "actions": [{"op": "add_instance", "preset": "base800"}],
        })
        pv = r.json()
        ok &= check("ai: preview diff",
                    r.status_code == 200
                    and len(pv["changes"]["instances"]["added"]) == 1
                    and pv["cost"]["delta"] > 0,
                    f'delta={pv.get("cost", {}).get("delta")}')
        ok &= check("ai: preview ничего не сохранил",
                    len(c.get(f"/api/projects/{pid}").json()
                        .get("instances", [])) == before_count)
        r = c.post(f"/api/projects/{pid}/preview", json={
            "actions": [{
                "op": "add_decor", "type": "plant", "name": "Тест-декор",
            }],
        })
        ok &= check("ai: preview декора", r.status_code == 200
                    and len(r.json().get("changes", {}).get("props", {})
                            .get("added", [])) == 1)

        r = c.post(f"/api/projects/{pid}/preview", json={
            "actions": [{"op": "add_instance", "preset": "base600"}],
        })
        pv = r.json()
        added = (pv.get("changes", {}).get("instances", {})
                 .get("added") or [{}])[0]
        ok &= check("ai: авто-постановка не в стену",
                    r.status_code == 200
                    and (added.get("x"), added.get("y")) != (50.0, 50.0)
                    and pv.get("errors") == 0,
                    f'x={added.get("x")} y={added.get("y")} '
                    f'errors={pv.get("errors")}')

        r = c.post(f"/api/projects/{pid}/preview", json={
            "actions": [{
                "op": "add_instance", "preset": "base600", "x": 1, "y": 1,
            }],
        })
        detail = (r.json().get("detail") or {}) if r.headers.get(
            "content-type", "").startswith("application/json") else {}
        msg = detail.get("message", "") if isinstance(detail, dict) else str(detail)
        ok &= check("ai: наложение отклонено с подсказкой",
                    r.status_code == 422 and "Свободное место" in msg,
                    msg[:60])

        r = c.post(f"/api/projects/{pid}/preview", json={
            "actions": [{
                "op": "add_decor", "type": "plant", "name": "В стену",
                "x": 1, "y": 1,
            }],
        })
        detail = (r.json().get("detail") or {}) if r.headers.get(
            "content-type", "").startswith("application/json") else {}
        msg = detail.get("message", "") if isinstance(detail, dict) else str(detail)
        ok &= check("ai: декор в стену отклонён",
                    r.status_code == 422 and "Свободное место" in msg,
                    msg[:60])

        r = c.post(f"/api/projects/{pid}/preview", json={
            "actions": [{"op": "add_wall_item", "kind": "socket"}],
        })
        room_ch = r.json().get("changes", {}).get("room", {})
        added_wi = ((room_ch.get("wallItems") or {}).get("after") or [{}])[0]
        ok &= check("ai: розетка ставится в свободное место",
                    r.status_code == 200
                    and float(added_wi.get("x") or 0) > 0,
                    str(added_wi.get("x")))

        # --- Коллизии при автопостановке и изменении модуля (BW) ---
        qpid = f"test-placement-{int(time.time() * 1000):x}"
        try:
            qdoc = project("Placement")
            qdoc["room"].update({
                "outline": [[0, 0], [3600, 0], [3600, 2800], [0, 2800]],
                "partitions": [],
                "openings": [
                    {"id": "w1", "kind": "window", "wall": 0,
                     "x": 600, "w": 1200, "z0": 900, "z1": 2300},
                ],
                "wallItems": [],
            })
            qdoc["instances"] = [{
                "id": "q1", "name": "Тумба 1", "x": 620, "y": 560,
                "z": 0, "rot": 180, "params": {
                    "W": 600, "D": 560, "H": 720, "mount": "floor",
                    "doors": 1, "plinthH": 100, "worktopT": 38,
                },
            }, {
                "id": "q2", "name": "Тумба 2", "x": 2420, "y": 560,
                "z": 0, "rot": 180, "params": {
                    "W": 600, "D": 560, "H": 720, "mount": "floor",
                    "doors": 1, "plinthH": 100, "worktopT": 38,
                },
            }]
            r = c.put(f"/api/projects/{qpid}", json=qdoc)
            ok &= check("placement: проект создан", r.status_code == 200)

            for preset, why in (("tall600", "две створки"),
                                ("wall800", "окно")):
                r = c.post(f"/api/projects/{qpid}/preview", json={
                    "actions": [{"op": "add_instance", "preset": preset}],
                })
                pvee = r.json() if r.status_code == 200 else {}
                ok &= check(f"placement: авто {preset} без ошибок ({why})",
                            r.status_code == 200
                            and pvee.get("errors") == 0,
                            f'errors={pvee.get("errors")} {r.text[:80]}')

            def reason(resp):
                body = resp.json() if resp.content else {}
                detail = body.get("detail") if isinstance(body, dict) else {}
                if isinstance(detail, dict):
                    return detail.get("message", "")
                return str(detail or body.get("detail") or "")

            r = c.post(f"/api/projects/{qpid}/preview", json={
                "actions": [{"op": "update_instance", "id": "q1",
                             "x": -100, "y": 300}],
            })
            ok &= check("placement: перенос в стену отклонён",
                        r.status_code == 422
                        and "Свободное место" in reason(r), reason(r)[:70])

            r = c.post(f"/api/projects/{qpid}/preview", json={
                "actions": [{"op": "update_instance", "id": "q1",
                             "params": {"W": 2000}}],
            })
            ok &= check("placement: расширение в соседа отклонено",
                        r.status_code == 422, reason(r)[:70])

            r = c.post(f"/api/projects/{qpid}/preview", json={
                "actions": [{"op": "add_instance", "preset": "tall600",
                             "params": {"H": 3000}}],
            })
            ok &= check("placement: выше потолка — отказ с причиной",
                        r.status_code == 422 and "высоте" in reason(r),
                        reason(r)[:70])

            r = c.post(f"/api/projects/{qpid}/preview", json={
                "actions": [{"op": "add_instance", "preset": "base600",
                             "x": 2000}],
            })
            ok &= check("placement: одна координата — понятная ошибка",
                        r.status_code == 422 and "x и y" in reason(r),
                        reason(r)[:70])
        finally:
            c.delete(f"/api/projects/{qpid}")

        # Все пресеты каталога должны ставиться без ошибок (включая ГОСТ).
        failed_presets = []
        for preset in ("base600", "base800", "drawers600",
                       "drawers-cabinet", "sink800", "wardrobe1200",
                       "chest900", "nightstand", "tall600", "open600",
                       "island", "wall600", "wall800", "mix900"):
            r = c.post(f"/api/projects/{pid}/preview", json={
                "actions": [{"op": "add_instance", "preset": preset}],
            })
            pv = r.json() if r.status_code == 200 else {}
            if r.status_code != 200 or pv.get("errors") != 0:
                failed_presets.append(
                    f'{preset}: {r.status_code} {pv.get("errors")}',
                )
        ok &= check("placement: все пресеты без ошибок",
                    not failed_presets, "; ".join(failed_presets))

        r = c.post(f"/api/projects/{pid}/preview", json={
            "actions": [
                {"op": "add_instance", "preset": "base600"},
                {"op": "update_instance", "id": "no-such-id", "x": 100},
            ],
        })
        ok &= check("ai: preview атомарный", r.status_code == 422
                    and len(c.get(f"/api/projects/{pid}").json()
                            .get("instances", [])) == before_count)

        r = c.post(f"/api/projects/{pid}/actions", json={
            "actions": [
                {"op": "add_instance", "preset": "base800"},
                {"op": "set_globals", "patch": {"t": 18}},
            ],
            "commit": True,
        })
        ok &= check("actions: set_globals commit", r.status_code == 200)
        saved = c.get(f"/api/projects/{pid}").json()
        ok &= check("actions: толщина применена",
                    saved["globals"]["t"] == 18
                    and saved["instances"][0]["params"]["t"] == 18)

        # Расстановка: проверка стены и автоплотнение (docs/20-layout-rules.md)
        lpid = f"test-layout-{int(time.time() * 1000):x}"
        try:
            bad = project("Расстановка")
            bad["room"] = {
                "w": 4000, "d": 3000, "h": 2700, "wallT": 100,
                "outline": [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
                "partitions": [{"a": [2000, 0], "b": [2000, 3000],
                                "wallT": 100}],
                "openings": [],
            }
            bad["instances"] = [{
                "id": "bad1", "name": "bad1", "x": 2000, "y": 1000,
                "z": 0, "rot": 0,
                "params": {"W": 600, "D": 560, "H": 720,
                           "mount": "floor"},
            }]
            r = c.put(f"/api/projects/{lpid}", json=bad)
            ok &= check("layout: проект создан", r.status_code == 200)

            lay = c.get(f"/api/projects/{lpid}/layout").json()
            ok &= check("layout: корпус в стене — ошибка",
                        lay.get("errors", 0) >= 1
                        and any(i["code"] == "in-wall"
                                for i in lay.get("issues", [])))
            prev = c.post(f"/api/projects/{lpid}/layout/normalize",
                          json={"commit": False}).json()
            ok &= check("layout: предпросмотр не сохраняет",
                        prev.get("committed") is False
                        and prev.get("instances", [{}])[0].get("x") == 2100
                        and prev.get("errors") == 0)
            still = c.get(f"/api/projects/{lpid}/layout").json()
            ok &= check("layout: предпросмотр не записан",
                        still.get("errors", 0) >= 1)

            done = c.post(f"/api/projects/{lpid}/layout/normalize",
                          json={"commit": True}).json()
            ok &= check("layout: нормализация применена",
                        done.get("committed") is True
                        and done.get("errors") == 0)
            after = c.get(f"/api/projects/{lpid}/layout").json()
            ok &= check("layout: после нормализации чисто",
                        after.get("errors") == 0, str(after.get("issues")))

            # декор — тоже твёрдое тело: проверяется и блокируется strict PUT
            doc = c.get(f"/api/projects/{lpid}").json()
            doc["props"] = [{
                "id": "pbad", "type": "plant", "name": "Кактус",
                "x": 50, "y": 50, "z": 0, "rot": 0,
                "w": 300, "d": 300, "h": 800, "color": "#5a7",
            }]
            c.put(f"/api/projects/{lpid}", json=doc)
            lay = c.get(f"/api/projects/{lpid}/layout").json()
            ok &= check("layout: декор в стене — ошибка",
                        any(i["code"] == "prop-in-wall"
                            for i in lay.get("issues", [])), lay.get("issues"))
            pre = c.post("/api/projects/validate", json=doc)
            ok &= check("layout: preflight отклоняет декор в стене",
                        pre.status_code == 200
                        and pre.json().get("errors", 0) > 0,
                        pre.text[:200])
            strict = c.put(f"/api/projects/{lpid}?strict=1", json=doc)
            ok &= check("layout: strict PUT не сохраняет декор в стене",
                        strict.status_code == 422, strict.text[:200])
            norm = c.post(f"/api/projects/{lpid}/layout/normalize",
                          json={"commit": True}).json()
            fixed_doc = c.get(f"/api/projects/{lpid}").json()
            moved = (fixed_doc.get("props") or [{}])[0]
            ok &= check("layout: нормализация разводит декор",
                        norm.get("committed") is True
                        and norm.get("errors") == 0
                        and (moved.get("x"), moved.get("y")) != (50, 50),
                        {"norm": norm, "prop": moved})
            doc["props"] = []
            strict_ok = c.put(f"/api/projects/{lpid}?strict=1", json=doc)
            ok &= check("layout: strict PUT принимает чистый проект",
                        strict_ok.status_code == 200)

            guide = c.get("/api/ai/guide").json()
            rules_text = " ".join(guide.get("rules", [])).lower()
            ok &= check("ai guide: правила расстановки",
                        "GET /api/projects/{id}/layout" in guide.get("endpoints", {})
                        and "цоколь" in rules_text
                        and "декор" in rules_text
                        and "strict" in rules_text)
        finally:
            c.delete(f"/api/projects/{lpid}")

        # --- Полное управление проектом через actions (ИИ-чат) ---
        rpid = f"test-design-{int(time.time() * 1000):x}"
        try:
            ddoc = project("Design")
            ddoc["room"].update({
                "outline": [[0, 0], [3600, 0], [3600, 2800], [0, 2800]],
                "partitions": [], "openings": [], "wallItems": [],
            })
            c.put(f"/api/projects/{rpid}", json=ddoc)
            act = lambda acts: c.post(
                f"/api/projects/{rpid}/actions",
                json={"actions": acts, "commit": True, "strict": True})

            r = act([{"op": "resize_room", "w": 4200, "d": 3000,
                      "h": 2700, "wallT": 100}])
            doc_room = c.get(f"/api/projects/{rpid}").json()["room"]
            ok &= check("design: resize_room",
                        r.status_code == 200
                        and doc_room["w"] == 4200 and doc_room["d"] == 3000
                        and len(doc_room["outline"]) == 4,
                        str(doc_room.get("outline")))

            act([{"op": "resize_room", "w": 4200, "d": 3000,
                  "shape": "l", "cutW": 1200, "cutD": 1000}])
            doc_room = c.get(f"/api/projects/{rpid}").json()["room"]
            ok &= check("design: L-комната", len(doc_room["outline"]) == 6,
                        str(doc_room.get("outline")))
            act([{"op": "resize_room", "w": 4200, "d": 3000,
                  "shape": "rect"}])

            r = act([{"op": "add_opening", "kind": "window", "wall": 0,
                      "x": 1000, "w": 1500, "z0": 900, "z1": 2200}])
            doc_room = c.get(f"/api/projects/{rpid}").json()["room"]
            ok &= check("design: окно", r.status_code == 200
                        and len(doc_room["openings"]) == 1,
                        str(doc_room.get("openings")))

            r = c.post(f"/api/projects/{rpid}/preview", json={
                "actions": [{"op": "add_opening", "kind": "window",
                             "wall": 0, "x": 4000, "w": 900}],
            })
            msg = ((r.json().get("detail") or {}).get("message") or "")
            ok &= check("design: проём за стеной отклонён",
                        r.status_code == 422 and "стену" in msg, msg[:70])

            r = act([{"op": "add_partition", "a": [2000, 0],
                      "b": [2000, 3000]}])
            doc_room = c.get(f"/api/projects/{rpid}").json()["room"]
            ok &= check("design: перегородка", r.status_code == 200
                        and len(doc_room["partitions"]) == 1,
                        str(doc_room.get("partitions")))

            r = act([{"op": "add_opening", "kind": "window", "wall": 4,
                      "x": 300, "w": 900, "z0": 900, "z1": 2200}])
            ok &= check("design: проём в перегородке", r.status_code == 200,
                        r.text[:80])

            r = c.post(f"/api/projects/{rpid}/preview", json={
                "actions": [{"op": "delete_partition", "index": 0}],
            })
            msg = ((r.json().get("detail") or {}).get("message") or "")
            ok &= check("design: перегородку с проёмом не удалить",
                        r.status_code == 422 and "перегородк" in msg,
                        msg[:70])

            doc = c.get(f"/api/projects/{rpid}").json()
            oid = doc["room"]["openings"][-1]["id"]
            act([{"op": "delete_opening", "id": oid}])
            act([{"op": "delete_partition", "index": 0}])
            doc_room = c.get(f"/api/projects/{rpid}").json()["room"]
            ok &= check("design: перегородка удалена",
                        not doc_room["partitions"])

            r = act([{"op": "add_instance", "preset": "base600"}])
            inst_id = r.json()["results"][0]["id"]
            r = act([{"op": "duplicate_instance", "id": inst_id}])
            layers = c.get(f"/api/projects/{rpid}/layout").json()
            ok &= check("design: копия модуля",
                        r.status_code == 200 and layers["errors"] == 0
                        and len(c.get(f"/api/projects/{rpid}").json()
                                ["instances"]) == 2,
                        str(layers.get("issues"))[:120])

            act([{"op": "set_instance_material", "id": inst_id,
                  "role": "facade",
                  "patch": {"name": "МДФ графит", "color": "#303030"}}])
            doc = c.get(f"/api/projects/{rpid}").json()
            got = next(i for i in doc["instances"] if i["id"] == inst_id)
            ok &= check("design: материал модуля",
                        got.get("materials", {}).get("facade", {})
                        .get("color") == "#303030",
                        str(got.get("materials")))

            r = act([{"op": "add_folder", "name": "Кухня",
                      "ids": [inst_id]}])
            fid = r.json()["results"][0]["id"]
            doc = c.get(f"/api/projects/{rpid}").json()
            ok &= check("design: папка", doc["folders"][0]["ids"] == [inst_id],
                        str(doc.get("folders")))
            act([{"op": "rename_project", "name": "Проект ИИ"}])
            ok &= check("design: переименование проекта",
                        c.get(f"/api/projects/{rpid}").json()["name"]
                        == "Проект ИИ")

            r = c.post(f"/api/projects/{rpid}/preview", json={
                "actions": [
                    {"op": "resize_room", "w": 5000, "d": 3200},
                    {"op": "add_folder", "name": "Зона 2"},
                ],
            })
            pvd = r.json()
            ok &= check("design: preview комнаты и папок",
                        r.status_code == 200
                        and "w" in pvd["changes"]["room"]
                        and len(pvd["changes"]["folders"]["added"]) == 1,
                        str(list(pvd.get("changes", {}).keys())))

            act([{"op": "normalize_layout"}])
            ok &= check("design: нормализация",
                        c.get(f"/api/projects/{rpid}/layout").json()
                        ["errors"] == 0)
            act([{"op": "delete_folder", "id": fid}])
            ok &= check("design: папка удалена",
                        not c.get(f"/api/projects/{rpid}").json()["folders"])
        finally:
            c.delete(f"/api/projects/{rpid}")

        fpid = f"test-fix-{int(time.time() * 1000):x}"
        try:
            fdoc = project("Fix")
            fdoc["room"].update({
                "outline": [[0, 0], [5000, 0], [5000, 4000], [0, 4000]],
                "partitions": [], "openings": [], "wallItems": [],
            })
            c.put(f"/api/projects/{fpid}", json=fdoc)
            r = c.post(f"/api/projects/{fpid}/actions", json={
                "actions": [{"op": "add_instance", "preset": "base600",
                             "params": {"W": 1200, "doors": 1}}],
                "commit": True, "strict": False,
            })
            fid2 = r.json()["results"][0]["id"]
            lay = c.get(f"/api/projects/{fpid}/layout").json()
            codes = {i["code"] for i in lay.get("issues", [])}
            ok &= check("fix: ошибка ширины створки есть",
                        "std-door-width" in codes, str(codes))
            r = c.post(f"/api/projects/{fpid}/actions", json={
                "actions": [{"op": "fix_issues", "issues": [
                    {"code": "std-door-width", "instance": fid2},
                    {"code": "std-shelf-span", "instance": fid2},
                ]}],
                "commit": True, "strict": False,
            })
            lay = c.get(f"/api/projects/{fpid}/layout").json()
            ok &= check("fix: створки исправлены",
                        r.status_code == 200
                        and lay["errors"] == 0,
                        str([i["code"] for i in lay.get("issues", [])]))
        finally:
            c.delete(f"/api/projects/{fpid}")

        # Выгрузки для цеха: SVG раскроя, DXF деталей, XLSX.
        for fmt in ("svg", "dxf", "xlsx"):
            r = c.post(f"/api/projects/{pid}/export/{fmt}")
            ok &= check(f"export: {fmt}", r.status_code == 200 and
                        len(r.content) > 1000)
        r = c.post(f"/api/projects/{pid}/quote.pdf")
        ok &= check("export: PDF КП", r.status_code == 200 and
                    r.content.startswith(b"%PDF") and len(r.content) > 5000)

        # Раскрой всего проекта: общая укладка + координаты деталей.
        r = c.post(f"/api/projects/{pid}/cutting")
        cut = r.json() if r.status_code == 200 else {}
        ok &= check("cutting: общий раскрой проекта",
                    r.status_code == 200 and cut.get("totals", {}).get("sheets", 0) > 0)
        ok &= check("cutting: координаты на листах",
                    any(s.get("placements") for s in cut.get("sheets", [])))

        r = c.post(f"/api/projects/{pid}/versions", json={"name": "Первый"})
        ok &= check("versions: create", r.status_code == 200)
        vid = r.json()["version"]["id"]

        versions = c.get(f"/api/projects/{pid}/versions").json()["versions"]
        ok &= check("versions: list", len(versions) == 1 and versions[0]["name"] == "Первый")

        r = c.get(f"/api/projects/{pid}/versions/{vid}")
        ok &= check("versions: get", r.status_code == 200 and r.json()["doc"]["name"] == "API тест")

        # изменить проект и откатиться
        changed = project("Изменённый")
        changed["instances"] = []
        c.put(f"/api/projects/{pid}", json=changed)
        r = c.post(f"/api/projects/{pid}/versions/{vid}/restore",
                   json={"backup": True})
        ok &= check("versions: restore", r.status_code == 200
                    and r.json()["project"]["name"] == "API тест")
        versions = c.get(f"/api/projects/{pid}/versions").json()["versions"]
        ok &= check("versions: автоснимок перед откатом", len(versions) == 2)

        r = c.delete(f"/api/projects/{pid}/versions/{vid}")
        ok &= check("versions: delete", r.status_code == 200)
    finally:
        c.delete(f"/api/projects/{pid}")

    print()
    print("Все проверки пройдены." if ok else "Есть ошибки.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
