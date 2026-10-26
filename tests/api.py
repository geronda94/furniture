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
