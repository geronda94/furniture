#!/usr/bin/env python3
"""CLI для базы бизнес-стратегий: список, оценки, заметки, экспорт, SQLite."""

import argparse
import json
import sqlite3
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "docs" / "business" / "strategy" / "strategies.json"
MD = ROOT / "docs" / "business" / "strategy" / "STRATEGIES.md"
SQLITE = ROOT / "docs" / "business" / "strategy" / "strategies.sqlite"

STATUSES = {"idea", "researching", "validating", "active", "paused", "rejected"}
CRITERIA = ["speed", "capital", "fit", "sales", "scale", "moat", "risk", "ceiling"]


def load():
    with open(DB, encoding="utf-8") as f:
        return json.load(f)


def save(data):
    data["updated"] = date.today().isoformat()
    with open(DB, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def score(item, weights):
    return round(sum(item["scores"].get(k, 0) * w for k, w in weights.items()), 2)


def find(data, sid):
    for item in data["strategies"]:
        if item["id"] == sid:
            return item
    raise SystemExit(f"не найдено: {sid}")


def validate(data):
    errors = []
    ids = set()
    if abs(sum(data["weights"].values()) - 1.0) > 1e-9:
        errors.append("weights не суммируются в 1.0")
    for item in data["strategies"]:
        sid = item.get("id")
        if not sid:
            errors.append("стратегия без id")
            continue
        if sid in ids:
            errors.append(f"дубликат id: {sid}")
        ids.add(sid)
        if item.get("status") not in STATUSES:
            errors.append(f"{sid}: неверный status {item.get('status')}")
        for key in ["name", "summary", "who_pays", "offer", "pricing", "first_cash"]:
            if not item.get(key):
                errors.append(f"{sid}: пустое поле {key}")
        for key in CRITERIA:
            v = item.get("scores", {}).get(key)
            if not isinstance(v, int) or not 1 <= v <= 5:
                errors.append(f"{sid}: score {key}={v} (нужно 1..5)")
    return errors


def cmd_list(data, args):
    items = data["strategies"]
    if args.status:
        items = [x for x in items if x["status"] == args.status]
    if args.tier:
        items = [x for x in items if x["tier"] == args.tier]
    if args.tag:
        items = [x for x in items if args.tag in x.get("tags", [])]
    rows = [(score(x, data["weights"]), x) for x in items]
    if args.min_score is not None:
        rows = [r for r in rows if r[0] >= args.min_score]
    key = args.sort
    if key == "score":
        rows.sort(key=lambda r: (-r[0], r[1]["id"]))
    elif key == "name":
        rows.sort(key=lambda r: r[1]["name"])
    else:
        rows.sort(key=lambda r: (-r[1]["scores"].get(key, 0), -r[0]))
    if args.limit:
        rows = rows[: args.limit]
    print(f"{'балл':>5}  {'ур':>2}  {'статус':<11} {'первые деньги':<14} id")
    print("-" * 78)
    for s, x in rows:
        print(f"{s:5.2f}  {x['tier']:>2}  {x['status']:<11} {x['first_cash']:<14} {x['id']}")
        print(f"       {x['name']}")
    print(f"\nвсего: {len(rows)}")


def cmd_show(data, args):
    print(json.dumps(find(data, args.id), ensure_ascii=False, indent=2))


def cmd_score(data, args):
    for x in data["strategies"]:
        print(f"{score(x, data['weights']):5.2f}  {x['id']:<28} {x['name']}")


def cmd_set_score(data, args):
    item = find(data, args.id)
    if args.criterion not in CRITERIA:
        raise SystemExit(f"критерий должен быть одним из: {', '.join(CRITERIA)}")
    if not 1 <= args.value <= 5:
        raise SystemExit("оценка должна быть 1..5")
    item["scores"][args.criterion] = args.value
    item["updated"] = date.today().isoformat()
    save(data)
    print(f"{args.id}: {args.criterion}={args.value}, балл={score(item, data['weights'])}")


def cmd_set_status(data, args):
    if args.status not in STATUSES:
        raise SystemExit(f"статус должен быть одним из: {', '.join(sorted(STATUSES))}")
    item = find(data, args.id)
    item["status"] = args.status
    item["updated"] = date.today().isoformat()
    save(data)
    print(f"{args.id}: status={args.status}")


def cmd_note(data, args):
    item = find(data, args.id)
    item.setdefault("notes", []).append(args.text)
    item["updated"] = date.today().isoformat()
    save(data)
    print(f"{args.id}: заметка добавлена ({len(item['notes'])})")


def cmd_add(data, args):
    raw = Path(args.file).read_text(encoding="utf-8") if args.file else args.json
    if not raw:
        raise SystemExit("нужен --file или --json")
    item = json.loads(raw)
    for key in ["id", "name", "summary", "who_pays", "offer", "pricing", "first_cash"]:
        if key not in item:
            raise SystemExit(f"в стратегии нет поля {key}")
    if "scores" not in item:
        item["scores"] = {k: 3 for k in CRITERIA}
    item.setdefault("category", "service")
    item.setdefault("tier", 1)
    item.setdefault("status", "idea")
    item.setdefault("economics", {})
    item.setdefault("pros", [])
    item.setdefault("cons", [])
    item.setdefault("risks", [])
    item.setdefault("next_steps", [])
    item.setdefault("tags", [])
    item.setdefault("notes", [])
    item.setdefault("created", date.today().isoformat())
    item["updated"] = date.today().isoformat()
    if any(x["id"] == item["id"] for x in data["strategies"]):
        raise SystemExit(f"id уже существует: {item['id']}")
    data["strategies"].append(item)
    save(data)
    print(f"добавлено: {item['id']} ({item['name']})")


def cmd_validate(data, args):
    errors = validate(data)
    if errors:
        print("ОШИБКИ:")
        for e in errors:
            print(" -", e)
        raise SystemExit(1)
    print(f"OK: {len(data['strategies'])} стратегий, веса суммируются в 1.0")


def cmd_stats(data, args):
    items = data["strategies"]
    print(f"всего стратегий: {len(items)}")
    print("\nпо статусу:")
    for st in sorted(STATUSES):
        n = sum(1 for x in items if x["status"] == st)
        if n:
            print(f"  {st:<12} {n}")
    print("\nпо тиру:")
    for t in [1, 2, 3]:
        n = sum(1 for x in items if x["tier"] == t)
        if n:
            print(f"  tier {t}: {n}")
    print("\nтоп-10 по баллу:")
    for s, x in sorted(((score(x, data["weights"]), x) for x in items), key=lambda r: -r[0])[:10]:
        print(f"  {s:5.2f}  {x['id']:<28} {x['name']}")


def cmd_export(data, args):
    items = data["strategies"]
    w = data["weights"]
    ranked = sorted(((score(x, w), x) for x in items), key=lambda r: -r[0])
    lines = []
    lines.append("# База бизнес-стратегий\n")
    lines.append(f"Обновлено: {data['updated']}\n")
    lines.append(f"**Цель:** {data['goal']}\n")
    lines.append("**Ограничения:** " + "; ".join(data["constraints"]) + "\n")
    lines.append("## Веса оценок\n")
    for k, v in w.items():
        lines.append(f"- `{k}` — {v:.2f}: {data['criteria'].get(k, '')}")
    lines.append("\n## Рейтинг\n")
    lines.append("| балл | тир | статус | первые деньги | стратегия | id |")
    lines.append("|---:|---:|---|---|---|---|")
    for s, x in ranked:
        lines.append(f"| {s:.2f} | {x['tier']} | {x['status']} | {x['first_cash']} | {x['name']} | `{x['id']}` |")
    lines.append("\n## Размышления\n")
    for r in data.get("reflections", []):
        lines.append(f"- {r}")
    rec = data.get("current_recommendation")
    if rec:
        lines.append("\n## Текущая рекомендация\n")
        lines.append(f"**Тезис:** {rec.get('thesis', '')}\n")
        for p in rec.get("portfolio", []):
            lines.append(f"- `{p['id']}` — {p['role']}")
        if rec.get("avoid"):
            lines.append("\n**Не сейчас:** " + ", ".join(f"`{x}`" for x in rec["avoid"]))
        if rec.get("gate"):
            lines.append(f"\n**Критерий:** {rec['gate']}")
    pilot = data.get("active_pilot")
    if pilot:
        lines.append("\n## Активный пилот\n")
        lines.append(f"- **Ниша:** {pilot.get('niche', '')}")
        lines.append(f"- **Документ:** `{pilot.get('doc', '')}`")
        lines.append(f"- **Оффер:** {pilot.get('offer', '')}")
        lines.append(f"- **Цена:** {pilot.get('price', '')}")
        lines.append(f"- **Цель 10 дней:** {pilot.get('goal_10_days', '')}")
        if pilot.get("metrics"):
            lines.append("- **Метрики:** " + "; ".join(pilot["metrics"]))
    for tier in [1, 2, 3]:
        lines.append(f"\n## Тир {tier}\n")
        for s, x in ranked:
            if x["tier"] != tier:
                continue
            lines.append(f"### {x['name']}\n")
            lines.append(f"`{x['id']}` · {x['category']} · статус: **{x['status']}** · балл: **{s:.2f}** · первые деньги: {x['first_cash']}\n")
            lines.append(f"{x['summary']}\n")
            lines.append(f"- **Кто платит:** {x['who_pays']}")
            lines.append(f"- **Оффер:** {x['offer']}")
            lines.append(f"- **Цена:** {x['pricing']}")
            e = x.get("economics", {})
            if e:
                lines.append(f"- **Экономика:** {e.get('unit','')} · {e.get('price','')} · себестоимость {e.get('cost','')} · маржа {e.get('margin','')}")
            sc = x["scores"]
            lines.append(f"- **Оценки:** speed {sc['speed']}, capital {sc['capital']}, fit {sc['fit']}, sales {sc['sales']}, scale {sc['scale']}, moat {sc['moat']}, risk {sc['risk']}, ceiling {sc['ceiling']}")
            if x.get("pros"):
                lines.append("- **Плюсы:** " + "; ".join(x["pros"]))
            if x.get("cons"):
                lines.append("- **Минусы:** " + "; ".join(x["cons"]))
            if x.get("risks"):
                lines.append("- **Риски:** " + "; ".join(x["risks"]))
            if x.get("next_steps"):
                lines.append("- **Первые шаги:** " + "; ".join(x["next_steps"]))
            if x.get("notes"):
                lines.append("- **Заметки:** " + "; ".join(x["notes"]))
            lines.append("")
    MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"написано: {MD}")


def cmd_sqlite(data, args):
    if SQLITE.exists():
        SQLITE.unlink()
    con = sqlite3.connect(SQLITE)
    con.execute(
        """CREATE TABLE strategies (
        id TEXT PRIMARY KEY, name TEXT, category TEXT, tier INTEGER, status TEXT,
        summary TEXT, who_pays TEXT, offer TEXT, pricing TEXT, first_cash TEXT,
        score REAL, speed INTEGER, capital INTEGER, fit INTEGER, sales INTEGER,
        scale INTEGER, moat INTEGER, risk INTEGER, ceiling INTEGER,
        tags TEXT, updated TEXT)"""
    )
    rows = []
    for x in data["strategies"]:
        sc = x["scores"]
        rows.append((
            x["id"], x["name"], x["category"], x["tier"], x["status"],
            x["summary"], x["who_pays"], x["offer"], x["pricing"], x["first_cash"],
            score(x, data["weights"]), sc["speed"], sc["capital"], sc["fit"], sc["sales"],
            sc["scale"], sc["moat"], sc["risk"], sc["ceiling"],
            ",".join(x.get("tags", [])), x.get("updated", ""),
        ))
    con.executemany("INSERT INTO strategies VALUES (" + ",".join(["?"] * 21) + ")", rows)
    con.commit()
    con.close()
    print(f"написано: {SQLITE} ({len(rows)} строк)")


def main():
    p = argparse.ArgumentParser(description="База бизнес-стратегий")
    sub = p.add_subparsers(dest="cmd", required=True)

    q = sub.add_parser("list", help="список с баллами")
    q.add_argument("--status")
    q.add_argument("--tier", type=int)
    q.add_argument("--tag")
    q.add_argument("--min-score", type=float)
    q.add_argument("--sort", default="score", choices=["score", "name"] + CRITERIA)
    q.add_argument("--limit", type=int)
    q.set_defaults(func=cmd_list)

    q = sub.add_parser("show", help="показать стратегию")
    q.add_argument("id")
    q.set_defaults(func=cmd_show)

    q = sub.add_parser("score", help="все баллы")
    q.set_defaults(func=cmd_score)

    q = sub.add_parser("set-score", help="поставить оценку")
    q.add_argument("id")
    q.add_argument("criterion", choices=CRITERIA)
    q.add_argument("value", type=int)
    q.set_defaults(func=cmd_set_score)

    q = sub.add_parser("set-status", help="сменить статус")
    q.add_argument("id")
    q.add_argument("status", choices=sorted(STATUSES))
    q.set_defaults(func=cmd_set_status)

    q = sub.add_parser("note", help="добавить заметку")
    q.add_argument("id")
    q.add_argument("text")
    q.set_defaults(func=cmd_note)

    q = sub.add_parser("add", help="добавить стратегию из JSON")
    q.add_argument("--file")
    q.add_argument("--json")
    q.set_defaults(func=cmd_add)

    q = sub.add_parser("validate", help="проверить базу")
    q.set_defaults(func=cmd_validate)

    q = sub.add_parser("stats", help="сводка")
    q.set_defaults(func=cmd_stats)

    q = sub.add_parser("export-md", help="сгенерировать Markdown")
    q.set_defaults(func=cmd_export)

    q = sub.add_parser("sqlite", help="сгенерировать SQLite для SQL-запросов")
    q.set_defaults(func=cmd_sqlite)

    args = p.parse_args()
    data = load()
    args.func(data, args)


if __name__ == "__main__":
    main()
