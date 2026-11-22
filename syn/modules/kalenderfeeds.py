"""Kalender-Feeds (iCal): ausgewählte Datumsfelder von Kontakten – Geburtstage, Jahrestage, „Kennengelernt“ … – als
Kalender zum Abonnieren (Google, Apple, Thunderbird, DAVx⁵/ICSx⁵). Je Feld: einmalig, monatlich oder jährlich.

Kalender-Apps können sich nicht anmelden, deshalb trägt die Adresse ein geheimes Token: /cal/<token>.ics
Neues Token = alte Adresse ungültig.
"""
import secrets
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from .. import db, model
from ..auth import Ctx, ctx_for, current
from ..util import date_parts, new_id, now
from ..vcard import fold_line

router = APIRouter(tags=["Kalender"])
REPEATS = ("once", "monthly", "yearly")
REPEAT_RULE = {"monthly": "FREQ=MONTHLY", "yearly": "FREQ=YEARLY"}


class FieldSel(BaseModel):
    field: str
    repeat: str = "yearly"


class FeedIn(BaseModel):
    name: str | None = None
    fields: list[FieldSel] | None = None
    circles: list[str] | None = None   # nur Personen in einem dieser Kreise (leer = alle)
    max_level: int | None = None       # nur bis zu diesem Ring
    with_pets: bool | None = None


def _date_fields(uid):
    return {d["id"]: d for d in db.q("SELECT * FROM field_defs WHERE user_id=? AND type='date'", uid)}


def _out(f, base=""):
    cfg = db.jl(f["config"], {}) or {}
    return {"id": f["id"], "name": f["name"], "fields": cfg.get("fields", []), "circles": cfg.get("circles", []),
            "max_level": cfg.get("max_level"), "with_pets": cfg.get("with_pets", True), "path": f"/cal/{f['token']}.ics",
            "created_at": f["created_at"]}


def _check(uid, body: FeedIn):
    defs = _date_fields(uid)
    for s in body.fields or []:
        if s.field not in defs:
            raise HTTPException(400, f"Kein Datumsfeld: {s.field}")
        if s.repeat not in REPEATS:
            raise HTTPException(400, "Wiederholung: once, monthly oder yearly")


@router.get("/api/v1/calendars")
def list_feeds(ctx: Ctx = Depends(current)):
    return [_out(f) for f in db.q("SELECT * FROM cal_feeds WHERE user_id=? ORDER BY created_at", ctx.uid)]


@router.post("/api/v1/calendars")
def create_feed(body: FeedIn, ctx: Ctx = Depends(current)):
    _check(ctx.uid, body)
    fid = new_id("cal")
    cfg = {"fields": [s.model_dump() for s in (body.fields or [FieldSel(field="f_bday", repeat="yearly")])],
           "circles": body.circles or [], "max_level": body.max_level, "with_pets": True if body.with_pets is None else body.with_pets}
    db.insert("cal_feeds", {"id": fid, "user_id": ctx.uid, "name": (body.name or "Geburtstage").strip(),
                            "token": secrets.token_urlsafe(24), "config": db.jd(cfg), "created_at": now(), "updated_at": now()})
    return _out(db.q1("SELECT * FROM cal_feeds WHERE id=?", fid))


def _own(uid, fid):
    f = db.q1("SELECT * FROM cal_feeds WHERE id=? AND user_id=?", fid, uid)
    if not f:
        raise HTTPException(404, "Kalender nicht gefunden")
    return f


@router.patch("/api/v1/calendars/{fid}")
def patch_feed(fid: str, body: FeedIn, ctx: Ctx = Depends(current)):
    f = _own(ctx.uid, fid)
    _check(ctx.uid, body)
    cfg = db.jl(f["config"], {}) or {}
    if body.fields is not None:
        cfg["fields"] = [s.model_dump() for s in body.fields]
    for k in ("circles", "max_level", "with_pets"):
        if k in body.model_fields_set:
            cfg[k] = getattr(body, k)
    upd = {"config": db.jd(cfg), "updated_at": now()}
    if body.name:
        upd["name"] = body.name.strip()
    db.update("cal_feeds", {"id": fid}, upd)
    return _out(db.q1("SELECT * FROM cal_feeds WHERE id=?", fid))


@router.post("/api/v1/calendars/{fid}/new-link")
def new_link(fid: str, ctx: Ctx = Depends(current)):
    _own(ctx.uid, fid)
    db.ex("UPDATE cal_feeds SET token=?, updated_at=? WHERE id=?", secrets.token_urlsafe(24), now(), fid)
    return _out(db.q1("SELECT * FROM cal_feeds WHERE id=?", fid))


@router.delete("/api/v1/calendars/{fid}")
def delete_feed(fid: str, ctx: Ctx = Depends(current)):
    _own(ctx.uid, fid)
    db.ex("DELETE FROM cal_feeds WHERE id=?", fid)
    return {"ok": True}


# ---------------------------------------------------------------- iCal

def _esc(s: str) -> str:
    return str(s).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _start(raw, repeat):
    """Startdatum je Wiederholung; None, wenn dafür Teile fehlen (z.B. einmalig ohne Jahr)."""
    y, m, d, season = date_parts(raw) if isinstance(raw, str) else (None, None, None, None)
    if season or not d:
        return None
    try:
        if repeat == "once":
            return date(y, m, d) if y and m else None
        if repeat == "yearly":
            return date(y or 2000, m, d) if m else None   # ohne Jahr: Schaltjahr als Anker, damit auch der 29.2. geht
        t = date.today()                                    # monatlich: nur der Tag zählt
        return date(y, m, d) if y and m else date(t.year, t.month, min(d, 28))
    except ValueError:
        return None


def build_ics(uid, f) -> str:
    cfg = db.jl(f["config"], {}) or {}
    defs = _date_fields(uid)
    sel = [s for s in cfg.get("fields", []) if s.get("field") in defs]
    circles, max_level = set(cfg.get("circles") or []), cfg.get("max_level")
    user = db.q1("SELECT * FROM users WHERE id=?", uid)
    ctx = ctx_for(user)
    host = (ctx.settings.get("public_host") or "").rstrip("/")
    if host and not host.startswith("http"):
        host = "https://" + host
    stamp = now().replace("-", "").replace(":", "")[:15] + "Z"
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//syn//Kontaktbuch//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             f"X-WR-CALNAME:{_esc(f['name'])}", "X-PUBLISHED-TTL:PT6H", "REFRESH-INTERVAL;VALUE=DURATION:PT6H"]
    for r in model.load_rows(ctx):
        if r["is_self"] or (r["kind"] == "pet" and not cfg.get("with_pets", True)):
            continue
        if circles and not circles & set(r.get("circles_all") or []):
            continue
        if max_level and (r.get("level") is None or r["level"] > int(max_level)):
            continue
        name = r["display"]
        for s in sel:
            v = (r.get("v") or {}).get(s["field"])
            start = _start(v.get("raw") if v else None, s["repeat"])
            if not start:
                continue
            d = defs[s["field"]]
            y = date_parts(v["raw"])[0]
            title = f"{name} – {d['name']}"
            desc = [f"{d['name']}: {v.get('d') or v['raw']}"]
            if y and s["repeat"] == "yearly":
                desc.append(f"seit {y}")
            if host:
                desc.append(f"{host}/#/p/{r['id']}")
            lines += ["BEGIN:VEVENT", f"UID:{r['id']}-{s['field']}-{s['repeat']}@syn", f"DTSTAMP:{stamp}",
                      f"DTSTART;VALUE=DATE:{start:%Y%m%d}", f"DTEND;VALUE=DATE:{start + timedelta(days=1):%Y%m%d}",
                      f"SUMMARY:{_esc(title)}", f"DESCRIPTION:{_esc(chr(10).join(desc))}", "TRANSP:TRANSPARENT"]
            if s["repeat"] in REPEAT_RULE:
                lines.append("RRULE:" + REPEAT_RULE[s["repeat"]])
            if host:
                lines.append(f"URL:{host}/#/p/{r['id']}")
            lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold_line(x) for x in lines) + "\r\n"


@router.get("/cal/{token}.ics", include_in_schema=False)
def feed(token: str):
    f = db.q1("SELECT * FROM cal_feeds WHERE token=?", token)
    if not f:
        raise HTTPException(404, "Kalender nicht gefunden")
    return Response(build_ics(f["user_id"], f), media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "private, max-age=900",
                             "Content-Disposition": f'inline; filename="{f["id"]}.ics"'})


# ---------------------------------------------------------------- Kalender in syn („Heute“ mit Vorschau und Monat)

def _occurs(raw, start: date, end: date, yearly=True):
    """Alle Tage zwischen start und end (einschließlich), an denen ein Datumswert fällig ist.
    Mit Jahr und yearly=False: nur der eine Tag. Ohne Jahr oder yearly: jedes Jahr am selben Tag."""
    y, m, d, season = date_parts(raw) if isinstance(raw, str) else (None, None, None, None)
    if season or not (m and d):
        return []
    out = []
    if not yearly:
        if y:
            try:
                t = date(y, m, d)
                if start <= t <= end:
                    out.append((t, None))
            except ValueError:
                pass
        return out
    for yy in range(start.year, end.year + 1):
        try:
            t = date(yy, m, d)
        except ValueError:          # 29.2. in Nicht-Schaltjahren → 28.2.
            t = date(yy, 2, 28)
        if start <= t <= end and (not y or yy >= y):
            out.append((t, (yy - y) if y else None))
    return out


# Wie die Felder im Kalender erscheinen: jährlich wiederkehrend, oder nur am Tag selbst
ONCE_FIELDS = {"f_seen"}


def occurrences(ctx, start: date, end: date, fields=None, circles=None, max_level=None):
    defs = _date_fields(ctx.uid)
    want = [f for f in (fields or defs.keys()) if f in defs]
    circles = set(circles or [])
    out = []
    for r in model.load_rows(ctx):
        if r["is_self"]:
            continue
        if circles and not circles & set(r.get("circles_all") or []):
            continue
        if max_level and (r.get("level") is None or r["level"] > int(max_level)):
            continue
        for fid in want:
            v = (r.get("v") or {}).get(fid)
            if not v or not isinstance(v.get("raw"), str):
                continue
            for day, years in _occurs(v["raw"], start, end, yearly=fid not in ONCE_FIELDS):
                out.append({"date": day.isoformat(), "field": fid, "field_name": defs[fid]["name"], "years": years,
                            "raw": v["raw"], "entity": {k: r.get(k) for k in ("id", "display", "name", "avatar", "kind",
                                                                              "main_circle_id", "level", "name_uncertain")}})
    out.sort(key=lambda x: (x["date"], x["field"] != "f_bday", x["entity"]["display"].lower()))
    return out


@router.get("/api/v1/calendar")
def calendar(start: str | None = None, end: str | None = None, days: int = 30, fields: str | None = None,
             circles: str | None = None, max_level: int | None = None, ctx: Ctx = Depends(current)):
    """Termine deiner Leute im Zeitraum (Standard: heute + 30 Tage). fields/circles kommagetrennt."""
    s = date.fromisoformat(start) if start else date.today()
    e = date.fromisoformat(end) if end else s + timedelta(days=max(0, min(days, 400)))
    if (e - s).days > 400:
        raise HTTPException(400, "Höchstens 400 Tage auf einmal")
    return {"start": s.isoformat(), "end": e.isoformat(),
            "items": occurrences(ctx, s, e, fields.split(",") if fields else None, circles.split(",") if circles else None, max_level)}


@router.get("/api/v1/calendar/day/{day}")
def calendar_day(day: str, ctx: Ctx = Depends(current)):
    """Ein Tag im Rückblick: wer an diesem Tag dran ist und Fotos (Immich) von diesem Tag in früheren Jahren."""
    d = date.fromisoformat(day)
    items = occurrences(ctx, d, d)
    md = f"-{d.month:02d}-{d.day:02d}"
    rows = db.q("SELECT asset_id, person_id, taken_at FROM immich_assets WHERE user_id=? AND substr(taken_at, 5, 6)=? "
                "AND substr(taken_at, 1, 4) < ? ORDER BY taken_at DESC LIMIT 400", ctx.uid, md, str(d.year))
    people = {}
    if rows:
        for v in db.q("SELECT owner_id, value FROM field_values WHERE user_id=? AND owner_type='entity' AND field_id='f_profile'", ctx.uid):
            val = db.jl(v["value"])
            if isinstance(val, dict) and val.get("service") == "immich" and val.get("id"):
                people[str(val["id"])] = v["owner_id"]
    seen, photos = set(), []
    for r in rows:
        if r["asset_id"] in seen:
            continue
        seen.add(r["asset_id"])
        photos.append({"id": r["asset_id"], "taken_at": r["taken_at"], "year": int(r["taken_at"][:4]),
                       "entity_id": people.get(r["person_id"])})
    return {"date": d.isoformat(), "items": items, "photos": photos[:120]}
