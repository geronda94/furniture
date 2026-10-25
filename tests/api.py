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
        "shop": "shop-default",
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

    pid = f"test-api-{int(time.time() * 1000):x}"
    try:
        r = c.put(f"/api/projects/{pid}", json=project("API тест"))
        ok &= check("project: create", r.status_code == 200)

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
