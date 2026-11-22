"""Routinen: Wann (Auslöser), Wenn (Bedingungen), Dann (Aktionen). Dazu Schnellaktionen und „Heute“."""
import asyncio
import calendar
import logging
from datetime import date, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth, config, db, model
from ..auth import Ctx, current
from ..model import Bad
from ..util import age_on, date_parts, days_since, local_now, new_id, now, today

router = APIRouter(prefix="/api/v1", tags=["Routinen"])
log = logging.getLogger("syn.routinen")

TRIGGERS = ("date", "schedule", "manual")
ACTIONS = ("set_today", "add_today", "increment", "set_value", "webhook", "card", "list", "import", "google_sync")
OPS = ("<=", "<", ">=", ">", "=", "!=", "contains", "in", "not_in", "empty", "not_empty", "days_since_gt",
       "days_since_lt", "is_true", "is_false")
WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]


def load(r):
    r = dict(r)
    r["trigger"] = db.jl(r["trigger"], {})
    r["conditions"] = db.jl(r["conditions"], [])
    r["actions"] = db.jl(r["actions"], [])
    r["enabled"] = bool(r["enabled"])
    return r


def validate(ctx, body: dict):
    t = body.get("trigger") or {}
    if t.get("type") not in TRIGGERS:
        raise Bad("Auslöser muss date, schedule oder manual sein")
    defs = model.field_defs(ctx.uid)
    if t["type"] == "date":
        d = defs.get(t.get("field"))
        if not d or d["type"] != "date":
            raise Bad("Auslöser „Datum erreicht“ braucht ein Datumsfeld (per ID)")
        if t.get("repeat", "yearly") not in ("once", "yearly", "monthly"):
            raise Bad("repeat: once, yearly oder monthly")
    if t["type"] == "schedule" and t.get("every") not in ("hourly", "daily", "weekly", "monthly"):
        raise Bad("every: hourly, daily, weekly oder monthly")
    special = {"f_level", "ist", "kind", "circle", "circle_kind", "lose", "on_phone", "name_unknown"}
    for c in body.get("conditions") or []:
        if c.get("field") not in special and c.get("field") not in defs:
            raise Bad(f"Bedingung: Feld-ID {c.get('field')} unbekannt")
        if c.get("op") not in OPS:
            raise Bad(f"Bedingung: Operator {c.get('op')} unbekannt")
    for a in body.get("actions") or []:
        if a.get("type") not in ACTIONS:
            raise Bad(f"Aktion {a.get('type')} unbekannt")
        if a["type"] == "add_today" and (a.get("field") not in defs or defs[a["field"]]["type"] != "date"):
            raise Bad("„Datum hinzufügen“ braucht ein Datumsfeld")
        if a["type"] in ("set_today", "increment", "set_value") and a.get("field") not in defs:
            raise Bad(f"Aktion {a['type']}: Feld-ID {a.get('field')} unbekannt")
        if a["type"] == "set_today" and defs[a["field"]]["type"] != "date":
            raise Bad("„Auf heute setzen“ nur bei Datumsfeldern")
        if a["type"] == "increment" and defs[a["field"]]["type"] != "number":
            raise Bad("„+1“ nur bei Zahlenfeldern")
        if a["type"] == "webhook" and not str(a.get("url", "")).startswith(("http://", "https://")):
            raise Bad("Webhook braucht eine http(s)-URL")


# ---------------------------------------------------------------- Bedingungen

def actual(ctx, row, field):
    if field == "f_level":
        return row["level"]
    if field == "ist":
        return row["ist"]["ring"] if row["ist"] else None
    if field == "kind":
        return row["kind"]
    if field == "circle":
        return row["circles_all"]
    if field == "circle_kind":
        cs = model.circles(ctx.uid)
        return sorted({cs[c]["kind_id"] for c in row["circles_all"] if c in cs and cs[c]["kind_id"]})
    if field == "lose":
        return not row["circles"]
    if field == "on_phone":
        return row["on_phone"]
    if field == "name_unknown":
        return not row["name"]
    x = row["v"].get(field)
    if not x:
        return None
    raw = x["raw"]
    return raw["id"] if isinstance(raw, dict) and "type" in raw and "id" in raw else raw


def check(ctx, row, c) -> tuple[bool, object]:
    a = actual(ctx, row, c["field"])
    op, v = c["op"], c.get("value")
    try:
        if op == "empty":
            return (a in (None, "", [], False), a)
        if op == "not_empty":
            return (a not in (None, "", [], False), a)
        if op == "is_true":
            return (bool(a), a)
        if op == "is_false":
            return (not a, a)
        if op in ("days_since_gt", "days_since_lt"):
            ds = days_since(a) if isinstance(a, str) else None
            if ds is None:
                # ohne Datum gilt „lange nicht gesehen“ als erfüllt
                return (op == "days_since_gt", None)
            return ((ds > float(v)) if op == "days_since_gt" else (ds < float(v)), ds)
        if a is None:
            return (op == "!=", a)
        if op == "contains":
            return ((v in a) if isinstance(a, list) else (str(v).lower() in str(a).lower()), a)
        if op in ("in", "not_in"):
            vs = v if isinstance(v, list) else [v]
            hit = bool(set(a) & set(vs)) if isinstance(a, list) else a in vs
            return (hit if op == "in" else not hit, a)
        if isinstance(a, list):
            a_cmp = a
        else:
            a_cmp = a
        if isinstance(a_cmp, (int, float)) and not isinstance(a_cmp, bool):
            v = float(v)
        ops = {"<=": lambda x, y: x <= y, "<": lambda x, y: x < y, ">=": lambda x, y: x >= y,
               ">": lambda x, y: x > y, "=": lambda x, y: x == y, "!=": lambda x, y: x != y}
        return (ops[op](a_cmp, v), a)
    except (TypeError, ValueError):
        return (False, a)


def matches(ctx, routine, row) -> bool:
    if row["is_self"]:
        return False
    return all(check(ctx, row, c)[0] for c in routine["conditions"])


# ---------------------------------------------------------------- Auslöser

def _date_in_year(y, m, d, feb29):
    if m == 2 and d == 29 and not calendar.isleap(y):
        return date(y, 3, 1) if feb29 == "mar1" else date(y, 2, 28)
    try:
        return date(y, m, d)
    except ValueError:
        return None


def next_date(trigger, row, start: date) -> date | None:
    """Nächstes Datum ≥ start, an dem die Routine für diese Person feuert."""
    t = trigger
    if t["type"] == "date":
        x = row["v"].get(t["field"])
        if not x:
            return None
        y, m, d, _season = date_parts(x["raw"])
        before = int(t.get("offset_days") or 0)
        rep = t.get("repeat", "yearly")
        if rep == "once":
            if not (y and m and d):
                return None
            dd = date(y, m, d) - timedelta(days=before)
            return dd if dd >= start else None
        if rep == "monthly":
            if not d:
                return None
            for i in range(0, 3):
                yy, mm = start.year + (start.month - 1 + i) // 12, (start.month - 1 + i) % 12 + 1
                last = calendar.monthrange(yy, mm)[1]
                dd = date(yy, mm, min(d, last)) - timedelta(days=before)
                if dd >= start:
                    return dd
            return None
        # jährlich: Tag und Monat
        if not (m and d):
            return None
        if not y and not t.get("without_year", True):
            return None
        for yy in (start.year, start.year + 1, start.year + 2):
            base = _date_in_year(yy, m, d, t.get("feb29", "feb28"))
            if base is None:
                continue
            if y and yy < y:
                continue
            dd = base - timedelta(days=before)
            if dd >= start:
                return dd
        return None
    if t["type"] == "schedule":
        return next_schedule(t, start)
    return None


def next_schedule(t, start: date) -> date:
    ev = t.get("every", "daily")
    if ev in ("daily", "hourly"):
        return start
    if ev == "weekly":
        wd = int(t.get("weekday", 0))
        return start + timedelta(days=(wd - start.weekday()) % 7)
    day = int(t.get("day", 1))
    for i in range(0, 2):
        yy, mm = start.year + (start.month - 1 + i) // 12, (start.month - 1 + i) % 12 + 1
        dd = date(yy, mm, min(day, calendar.monthrange(yy, mm)[1]))
        if dd >= start:
            return dd
    return start


def trigger_text(t) -> str:
    if t["type"] == "manual":
        return f"Knopf „{t.get('label') or 'Ausführen'}“"
    if t["type"] == "schedule":
        ev = t.get("every")
        if ev == "weekly":
            return f"wöchentlich, {WEEKDAYS[int(t.get('weekday', 0))]} {t.get('time', '08:00')}"
        if ev == "monthly":
            return f"monatlich am {t.get('day', 1)}., {t.get('time', '08:00')}"
        if ev == "hourly":
            return "stündlich"
        return f"täglich {t.get('time', '08:00')}"
    return {"once": "einmalig", "yearly": "jährlich", "monthly": "monatlich"}.get(t.get("repeat", "yearly"), "")


# ---------------------------------------------------------------- Aktionen

def person_payload(ctx, row, defs, names):
    host = (ctx.settings.get("public_host") or "").rstrip("/")
    if host and not host.startswith("http"):
        host = "https://" + host
    bday = row["v"].get("f_bday", {}).get("raw")
    return {
        "id": row["id"], "name": row["name"], "display": row["display"], "kind": row["kind"],
        "name_uncertain": row["name_uncertain"], "level": row["level"],
        "url": f"{host}/#/p/{row['id']}" if host else None,
        "age": age_on(bday, local_now().date()) if bday else None,
        "circles": [names.get(c, c) for c in row["circles_all"]],
        "fields": {fid: {"name": defs[fid]["name"], "value": x["raw"], "uncertain": x["u"]}
                   for fid, x in row["v"].items() if fid in defs},
    }


def render(tpl: str, row, ctx, on: date) -> str:
    if not tpl:
        return ""
    bday = row["v"].get("f_bday", {}).get("raw") if row else None
    if bday:
        y = date_parts(bday)[0]
        alter = f"wird {on.year - y}" if y else "Alter unbekannt"
    else:
        alter = "Alter unbekannt"
    seen = row["v"].get("f_seen", {}).get("raw") if row else None
    ds = days_since(seen) if seen else None
    vals = {"name": row["display"] if row else "", "alter": alter, "datum": on.strftime("%d.%m."),
            "tage": f"{ds} Tage" if ds is not None else "noch nie", "ring": str(row["level"] or "–") if row else ""}
    out = tpl
    for k, v in vals.items():
        out = out.replace("{" + k + "}", v)
    return out


def build_payload(ctx, routine, rows, on: date):
    defs = model.field_defs(ctx.uid)
    names = {c["id"]: c["name"] for c in model.circles(ctx.uid).values()}
    p = {"routine": {"id": routine.get("id"), "name": routine.get("name")}, "trigger": routine["trigger"],
         "fired_at": now(), "date": on.isoformat(), "user": ctx.user["username"]}
    if routine["trigger"]["type"] == "schedule":
        p["persons"] = [person_payload(ctx, r, defs, names) for r in rows]
    else:
        p["person"] = person_payload(ctx, rows[0], defs, names) if rows else None
    return p


def send_webhook(a, payload) -> str:
    try:
        r = httpx.request(a.get("method", "POST"), a["url"], json=payload, headers=a.get("headers") or {},
                          timeout=10)
        return f"Webhook {r.status_code}"
    except httpx.HTTPError as e:
        return f"Webhook-Fehler: {e}"


def run_actions(ctx, routine, rows, on: date, source=None) -> list[str]:
    """Führt die Aktionen aus. Datum/Knopf: pro Person. Zeitplan: einmal mit allen Treffern."""
    src = source or ("manual" if routine["trigger"]["type"] == "manual" else f"Routine: {routine.get('name')}")
    res = []
    per_person = routine["trigger"]["type"] != "schedule"
    for a in routine["actions"]:
        t = a["type"]
        if t == "add_today":
            for r in rows:
                model.add_entity_date(ctx.uid, r["id"], a["field"], on.isoformat(), src)
            res.append(f"{t}: {len(rows)}")
        elif t in ("set_today", "increment", "set_value"):
            for r in rows:
                if t == "set_today":
                    model.set_entity_field(ctx.uid, r["id"], a["field"], on.isoformat(), src)
                elif t == "increment":
                    cur = r["v"].get(a["field"], {}).get("raw") or 0
                    model.set_entity_field(ctx.uid, r["id"], a["field"], cur + float(a.get("by", 1)), src)
                else:
                    model.set_entity_field(ctx.uid, r["id"], a["field"], a.get("value"), src)
            res.append(f"{t}: {len(rows)}")
        elif t == "card":
            for r in rows:
                db.insert("today_items", {"id": new_id("t"), "user_id": ctx.uid, "routine_id": routine.get("id"),
                                          "entity_id": r["id"], "kind": "card",
                                          "title": render(a.get("title") or routine["name"], r, ctx, on),
                                          "body": render(a.get("text") or "", r, ctx, on), "day": on.isoformat(),
                                          "created_at": now(), "data": "{}"})
            res.append(f"Karten: {len(rows)}")
        elif t == "list":
            if rows:
                items = [{"id": r["id"], "name": r["display"], "text": render(a.get("item") or "{tage}", r, ctx, on),
                          "row": {"name": r["name"], "description": r["description"], "name_uncertain": r["name_uncertain"],
                                  "main_circle_id": r["main_circle_id"], "avatar": r["avatar"], "kind": r["kind"]}}
                         for r in rows]
                db.ex("UPDATE today_items SET dismissed=1 WHERE user_id=? AND routine_id=? AND kind='list'",
                      ctx.uid, routine.get("id"))
                db.insert("today_items", {"id": new_id("t"), "user_id": ctx.uid, "routine_id": routine.get("id"),
                                          "entity_id": None, "kind": "list",
                                          "title": a.get("title") or routine["name"], "body": "",
                                          "day": on.isoformat(), "created_at": now(),
                                          "data": db.jd({"items": items})})
            res.append(f"Liste: {len(rows)}")
        elif t == "webhook":
            if per_person:
                for r in rows:
                    res.append(send_webhook(a, build_payload(ctx, routine, [r], on)))
            elif rows or a.get("send_empty"):
                res.append(send_webhook(a, build_payload(ctx, routine, rows, on)))
        elif t == "import":
            from ..importe import run_importer
            res.append(run_importer(ctx, a.get("importer")))
        elif t == "google_sync":
            from .google_sync import sync
            res.append("Google: " + sync(ctx))
    return res


# ---------------------------------------------------------------- Ausführung nach Zeitplan

def _time_reached(t, nowdt: datetime) -> bool:
    hh, mm = (t.get("time") or "08:00").split(":")
    return (nowdt.hour, nowdt.minute) >= (int(hh), int(mm))


def run_due(nowdt: datetime | None = None):
    nowdt = nowdt or local_now()
    day = nowdt.date()
    for u in db.q("SELECT * FROM users"):
        ctx = auth.ctx_for(u)
        rows = None
        for r in db.q("SELECT * FROM routines WHERE user_id=? AND enabled=1", u["id"]):
            r = load(r)
            t = r["trigger"]
            try:
                if t["type"] == "date" and _time_reached(t, nowdt):
                    rows = rows if rows is not None else model.load_rows(ctx)
                    hits = []
                    for row in rows:
                        if next_date(t, row, day) == day and matches(ctx, r, row):
                            if db.val("SELECT 1 FROM routine_runs WHERE routine_id=? AND entity_id=? AND run_key=?",
                                      r["id"], row["id"], day.isoformat()):
                                continue
                            db.insert("routine_runs", {"routine_id": r["id"], "entity_id": row["id"],
                                                       "run_key": day.isoformat(), "at": now()})
                            hits.append(row)
                    if hits:
                        out = run_actions(ctx, r, hits, day)
                        db.ex("UPDATE routines SET last_run_at=?, last_status=? WHERE id=?", now(),
                              "; ".join(out), r["id"])
                        rows = None
                elif t["type"] == "schedule":
                    if t.get("every") == "hourly":
                        key = nowdt.strftime("%Y-%m-%dT%H")
                        due = True
                    else:
                        key = day.isoformat()
                        due = next_schedule(t, day) == day and _time_reached(t, nowdt)
                    if due and not db.val("SELECT 1 FROM routine_runs WHERE routine_id=? AND entity_id='*' "
                                          "AND run_key=?", r["id"], key):
                        db.insert("routine_runs", {"routine_id": r["id"], "entity_id": "*", "run_key": key,
                                                   "at": now()})
                        rows = rows if rows is not None else model.load_rows(ctx)
                        needs_rows = any(a["type"] not in ("import", "google_sync") for a in r["actions"])
                        hits = [x for x in rows if matches(ctx, r, x)] if needs_rows else []
                        out = run_actions(ctx, r, hits, day)
                        db.ex("UPDATE routines SET last_run_at=?, last_status=? WHERE id=?", now(),
                              "; ".join(out), r["id"])
                        rows = None
            except Exception as e:  # eine kaputte Routine darf die anderen nicht aufhalten
                log.exception("Routine %s", r["id"])
                db.ex("UPDATE routines SET last_status=? WHERE id=?", f"Fehler: {e}", r["id"])


async def scheduler_loop():
    while True:
        try:
            await asyncio.to_thread(_tick)
        except Exception:
            log.exception("Scheduler")
        await asyncio.sleep(30)


def _tick():
    run_due()
    db.close()


async def background():
    """Wird von main.py beim Start als Hintergrund-Aufgabe gestartet."""
    if config.SCHEDULER:
        await scheduler_loop()


# ---------------------------------------------------------------- API

@router.get("/routines")
def list_routines(ctx: Ctx = Depends(current)):
    out = []
    for r in db.q("SELECT * FROM routines WHERE user_id=? ORDER BY created_at", ctx.uid):
        r = load(r)
        r["trigger_text"] = trigger_text(r["trigger"])
        r["used_by_fields"] = [d["id"] for d in model.field_defs(ctx.uid).values() if d["quick_routine_id"] == r["id"]]
        out.append(r)
    return out


class RoutineIn(BaseModel):
    name: str
    enabled: bool = True
    trigger: dict
    conditions: list[dict] = []
    actions: list[dict] = []


@router.post("/routines")
def create_routine(body: RoutineIn, ctx: Ctx = Depends(current)):
    validate(ctx, body.model_dump())
    rid = new_id("r")
    db.insert("routines", {"id": rid, "user_id": ctx.uid, "name": body.name, "enabled": int(body.enabled),
                           "trigger": db.jd(body.trigger), "conditions": db.jd(body.conditions),
                           "actions": db.jd(body.actions), "created_at": now()})
    return get_routine(rid, ctx)


@router.get("/routines/{rid}")
def get_routine(rid: str, ctx: Ctx = Depends(current)):
    r = db.q1("SELECT * FROM routines WHERE id=? AND user_id=?", rid, ctx.uid)
    if not r:
        raise HTTPException(404, "Routine nicht gefunden")
    r = load(r)
    r["trigger_text"] = trigger_text(r["trigger"])
    return r


@router.put("/routines/{rid}")
def update_routine(rid: str, body: RoutineIn, ctx: Ctx = Depends(current)):
    get_routine(rid, ctx)
    validate(ctx, body.model_dump())
    db.update("routines", {"id": rid}, {"name": body.name, "enabled": int(body.enabled),
                                        "trigger": db.jd(body.trigger), "conditions": db.jd(body.conditions),
                                        "actions": db.jd(body.actions)})
    return get_routine(rid, ctx)


@router.patch("/routines/{rid}")
def toggle_routine(rid: str, body: dict, ctx: Ctx = Depends(current)):
    get_routine(rid, ctx)
    if "enabled" in body:
        db.ex("UPDATE routines SET enabled=? WHERE id=?", int(bool(body["enabled"])), rid)
    if "name" in body:
        db.ex("UPDATE routines SET name=? WHERE id=?", body["name"], rid)
    return get_routine(rid, ctx)


@router.delete("/routines/{rid}")
def delete_routine(rid: str, ctx: Ctx = Depends(current)):
    get_routine(rid, ctx)
    db.ex("UPDATE field_defs SET quick_routine_id=NULL WHERE user_id=? AND quick_routine_id=?", ctx.uid, rid)
    db.ex("DELETE FROM routines WHERE id=?", rid)
    db.ex("DELETE FROM routine_runs WHERE routine_id=?", rid)
    return {"ok": True}


class TestIn(BaseModel):
    routine: dict | None = None  # ungespeicherte Routine (für die Vorschau vor dem Speichern)
    routine_id: str | None = None
    entity_id: str | None = None


@router.post("/routines/test")
def test_routine(body: TestIn, ctx: Ctx = Depends(current)):
    """Mit einer Person testen: Bedingungen einzeln, nächster Termin und Vorschau der Webhook-Daten."""
    if body.routine_id:
        r = get_routine(body.routine_id, ctx)
    elif body.routine:
        r = {"id": None, "name": body.routine.get("name", "Neue Routine"), "trigger": body.routine.get("trigger", {}),
             "conditions": body.routine.get("conditions", []), "actions": body.routine.get("actions", [])}
        validate(ctx, r)
    else:
        raise Bad("routine oder routine_id fehlt")
    rows = model.load_rows(ctx)
    on = local_now().date()
    out = {"trigger_text": trigger_text(r["trigger"])}
    if body.entity_id:
        row = next((x for x in rows if x["id"] == body.entity_id), None)
        if not row:
            raise HTTPException(404, "Person nicht gefunden")
        conds = []
        for c in r["conditions"]:
            ok, a = check(ctx, row, c)
            conds.append({**c, "ok": ok, "actual": a})
        nd = next_date(r["trigger"], row, on) if r["trigger"]["type"] != "manual" else None
        out.update({"conditions": conds, "matches": all(c["ok"] for c in conds), "next": nd and nd.isoformat(),
                    "payload": build_payload(ctx, r, [row], nd or on),
                    "preview": {a["type"]: render(a.get("title") or "", row, ctx, nd or on) for a in r["actions"]
                                if a["type"] in ("card", "list")}})
    hits = [x for x in rows if matches(ctx, r, x)]
    if r["trigger"]["type"] == "schedule":
        out["payload_all"] = build_payload(ctx, r, hits, on)
    upcoming = []
    if r["trigger"]["type"] == "date":
        for x in hits:
            nd = next_date(r["trigger"], x, on)
            if nd:
                upcoming.append({"id": x["id"], "name": x["display"], "date": nd.isoformat()})
        upcoming.sort(key=lambda u: u["date"])
    elif r["trigger"]["type"] == "schedule":
        upcoming = [{"date": next_schedule(r["trigger"], on).isoformat(), "count": len(hits)}]
    out.update({"match_count": len(hits), "upcoming": upcoming[:20]})
    return out


@router.post("/routines/{rid}/run")
def run_now(rid: str, body: dict | None = None, ctx: Ctx = Depends(current)):
    """Sofort ausführen. Bei Datum-Routinen nur für Personen, deren Termin heute ist."""
    r = get_routine(rid, ctx)
    rows = model.load_rows(ctx)
    on = local_now().date()
    eid = (body or {}).get("entity_id")
    if eid:
        hits = [x for x in rows if x["id"] == eid]
    elif r["trigger"]["type"] == "date":
        hits = [x for x in rows if next_date(r["trigger"], x, on) == on and matches(ctx, r, x)]
    else:
        hits = [x for x in rows if matches(ctx, r, x)]
    out = run_actions(ctx, r, hits, on)
    db.ex("UPDATE routines SET last_run_at=?, last_status=? WHERE id=?", now(), "; ".join(out), rid)
    return {"ok": True, "result": out, "count": len(hits)}


@router.post("/entities/{eid}/actions/{rid}")
def quick_action(eid: str, rid: str, ctx: Ctx = Depends(current)):
    """Schnellaktion an einer Person, z.B. „Heute gesehen“ (setzt Datum und erhöht den Zähler)."""
    r = get_routine(rid, ctx)
    if r["trigger"]["type"] != "manual":
        raise Bad("Nur Routinen mit manuellem Auslöser sind Schnellaktionen")
    rows = model.load_rows(ctx, ids=[eid])
    if not rows:
        raise HTTPException(404, "Person nicht gefunden")
    if not all(check(ctx, rows[0], c)[0] for c in r["conditions"]):
        raise Bad("Bedingungen der Routine nicht erfüllt")
    with db.tx():
        res = run_actions(ctx, r, rows, local_now().date())
    from .lebewesen import entity_full
    return {"result": res, "entity": entity_full(ctx, eid)}


@router.post("/seen-today/{eid}")
def seen_today(eid: str, ctx: Ctx = Depends(current)):
    """Kurzform für die Standard-Schnellaktion „Heute gesehen“."""
    rid = db.val("SELECT quick_routine_id FROM field_defs WHERE user_id=? AND id='f_seen'", ctx.uid)
    if rid:
        return quick_action(eid, rid, ctx)
    model.set_entity_field(ctx.uid, eid, "f_seen", today())
    from .lebewesen import entity_full
    return {"result": ["set_today"], "entity": entity_full(ctx, eid)}


def routines_for(ctx, eid):
    """Routinen, die für diese Person greifen (mit nächstem Termin)."""
    rows = model.load_rows(ctx, ids=[eid])
    if not rows:
        return []
    row = rows[0]
    on = local_now().date()
    out = []
    for r in db.q("SELECT * FROM routines WHERE user_id=? AND enabled=1", ctx.uid):
        r = load(r)
        if r["trigger"]["type"] == "manual":
            continue
        if any(a["type"] in ("import", "google_sync") for a in r["actions"]):
            continue
        if not matches(ctx, r, row):
            continue
        nd = next_date(r["trigger"], row, on)
        if r["trigger"]["type"] == "date" and not nd:
            continue
        out.append({"id": r["id"], "name": r["name"], "trigger_text": trigger_text(r["trigger"]),
                    "next": nd and nd.isoformat()})
    return out


# ---------------------------------------------------------------- Heute

@router.get("/today")
def today_page(ctx: Ctx = Depends(current)):
    since = (local_now().date() - timedelta(days=7)).isoformat()
    items = db.q("SELECT * FROM today_items WHERE user_id=? AND dismissed=0 AND day>=? "
                 "ORDER BY day DESC, kind, created_at", ctx.uid, since)
    ids = {i["entity_id"] for i in items if i["entity_id"]}
    rows = {r["id"]: r for r in model.load_rows(ctx, ids=ids)} if ids else {}
    for i in items:
        i["data"] = db.jl(i["data"], {})
        r = rows.get(i["entity_id"])
        if r:
            i["entity"] = {"id": r["id"], "display": r["display"], "avatar": r["avatar"], "kind": r["kind"],
                           "name": r["name"], "description": r["description"], "level": r["level"],
                           "bund_kind": r["bund_kind"], "bday": r["v"].get("f_bday", {}).get("raw"),
                           "main_circle_id": r["main_circle_id"], "name_uncertain": r["name_uncertain"],
                           "phone": r["v"].get("f_phone", {}).get("raw"),
                           "email": r["v"].get("f_email", {}).get("raw")}
    return {"date": today(), "items": items}


@router.post("/today/{tid}/dismiss")
def dismiss(tid: str, ctx: Ctx = Depends(current)):
    db.ex("UPDATE today_items SET dismissed=1 WHERE id=? AND user_id=?", tid, ctx.uid)
    return {"ok": True}
