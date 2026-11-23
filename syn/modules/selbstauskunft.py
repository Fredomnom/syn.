"""Pflege-Link: eine Person prüft und ergänzt ihre eigenen Kontaktdaten – ohne Konto, über einen geheimen Link.

Sie sieht nur die freigegebenen Felder (Telefon, E-Mail, Adresse, Geburtstag …), nie Ring, Kreise, Notizen, Bünde
oder Fotos. Was sie ändert, wird nie direkt übernommen, sondern landet als Vorschlag (Quelle „selbst“).
Der Link gilt 30 Tage (bewusst keine Einstellung) und lässt sich jederzeit zurückziehen oder neu erzeugen.
"""
import secrets
from datetime import datetime, timedelta, timezone

import base64

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import config, db, model
from ..auth import Ctx, current, user_settings
from ..model import display_name
from ..util import new_id, now
from .vorschlaege import add_suggestion

router = APIRouter(tags=["Pflege-Links"])
SOURCE = "selbst"
DAYS = 30
DEFAULT_FIELDS = ["f_phone", "f_email", "f_addr", "f_bday", "f_city", "f_profile"]
TYPES = ("text", "phone", "email", "date", "address", "profile", "url")
MAX_PER_FIELD, MAX_LEN, MAX_ANSWERS = 10, 300, 30


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _active(l):
    return l and not l["revoked_at"] and l["expires_at"] > _iso(datetime.now(timezone.utc))


def _defs(uid, ids):
    defs = model.field_defs(uid)
    return [defs[f] for f in ids if f in defs and defs[f]["type"] in TYPES and defs[f]["scope"] in ("person", "both")]


def _out(l):
    fl = db.jl(l["fields"], [])
    return {"id": l["id"], "path": f"/u/{l['token']}", "fields": [f for f in fl if f != BOOK], "freundebuch": BOOK in fl, "created_at": l["created_at"],
            "expires_at": l["expires_at"], "revoked": bool(l["revoked_at"]), "active": _active(l),
            "last_used_at": l["last_used_at"], "answers": l["answers"]}


class LinkIn(BaseModel):
    fields: list[str] | None = None
    freundebuch: bool = True      # Freundebuch-Fragen mit dazu (Antworten werden direkt gespeichert)


BOOK = "freundebuch"   # steht als Markierung in der Feldliste des Links


def _book_defs(uid):
    """Freundebuch-Fragen: alle Felder der Gruppe „freundebuch“ (ohne Foto/Unterschrift, die haben eigene Wege)."""
    return [d for d in model.field_defs(uid).values() if (d.get("options") or {}).get("group") == BOOK
            and d["type"] in ("text", "note") and d["scope"] in ("person", "both")]


@router.get("/api/v1/entities/{eid}/update-link")
def get_link(eid: str, ctx: Ctx = Depends(current)):
    model.get_entity(ctx.uid, eid)
    l = db.q1("SELECT * FROM update_links WHERE user_id=? AND entity_id=? ORDER BY created_at DESC LIMIT 1", ctx.uid, eid)
    allowed = [{"id": d["id"], "name": d["name"]} for d in _defs(ctx.uid, list(model.field_defs(ctx.uid)))]
    return {"link": _out(l) if l else None, "available": allowed, "default": DEFAULT_FIELDS, "days": DAYS}


@router.post("/api/v1/entities/{eid}/update-link")
def create_link(eid: str, body: LinkIn, ctx: Ctx = Depends(current)):
    e = model.get_entity(ctx.uid, eid)
    if e["is_self"]:
        raise HTTPException(400, "Für deinen eigenen Eintrag nicht nötig")
    fields = [d["id"] for d in _defs(ctx.uid, body.fields or DEFAULT_FIELDS)]
    if not fields:
        raise HTTPException(400, "Mindestens ein Feld freigeben")
    t = datetime.now(timezone.utc)
    # immer nur ein gültiger Link je Person – ein neuer macht den alten ungültig
    db.ex("UPDATE update_links SET revoked_at=? WHERE user_id=? AND entity_id=? AND revoked_at IS NULL", now(), ctx.uid, eid)
    lid = new_id("ul")
    db.insert("update_links", {"id": lid, "user_id": ctx.uid, "entity_id": eid, "token": secrets.token_urlsafe(18),
                               "fields": db.jd(fields + ([BOOK] if body.freundebuch else [])), "created_at": now(), "expires_at": _iso(t + timedelta(days=DAYS)), "answers": 0})
    return _out(db.q1("SELECT * FROM update_links WHERE id=?", lid))


@router.delete("/api/v1/update-links/{lid}")
def revoke_link(lid: str, ctx: Ctx = Depends(current)):
    if not db.val("SELECT 1 FROM update_links WHERE id=? AND user_id=?", lid, ctx.uid):
        raise HTTPException(404, "Link nicht gefunden")
    db.ex("UPDATE update_links SET revoked_at=? WHERE id=?", now(), lid)
    return {"ok": True}


# ---------------------------------------------------------------- öffentlich (ohne Anmeldung)

def _by_token(token):
    l = db.q1("SELECT * FROM update_links WHERE token=?", token)
    if not _active(l):
        raise HTTPException(404, "Dieser Link ist abgelaufen oder wurde zurückgezogen.")
    return l


@router.get("/api/v1/public/update/{token}", include_in_schema=False)
def public_get(token: str):
    l = _by_token(token)
    uid, eid = l["user_id"], l["entity_id"]
    e = model.get_entity(uid, eid)
    me = model.get_entity(uid, model.self_id(uid))
    vals = model.get_values("entity", eid, include_deprecated=False)
    fl = db.jl(l["fields"], [])
    defs = _defs(uid, fl)
    book = None
    if BOOK in fl:
        from ..importers.immich import connected
        prim = lambda fid: (vals.get(fid) or [{}])[0].get("value")  # noqa: E731
        book = {"questions": [{"id": d["id"], "name": d["name"], "type": d["type"], "value": prim(d["id"])} for d in _book_defs(uid)],
                "photo": connected(uid), "has_photo": bool(prim("f_fb_photo")), "has_sign": bool(prim("f_fb_sign"))}
    services = [{k: s.get(k) for k in ("id", "name")} for s in user_settings(uid).get("services", [])]
    return {
        "owner": display_name(me), "owner_first": me.get("first_name") or display_name(me).split(" ")[0],
        "name": e["name"] or "", "first_name": e.get("first_name") or (e["name"] or "").split(" ")[0],
        "expires_at": l["expires_at"], "services": services,
        "fields": [{"id": d["id"], "name": d["name"], "type": d["type"], "multi": bool(d["multi"]),
                    "values": [{"value": v["value"], "label": v.get("label")} for v in vals.get(d["id"], [])]} for d in defs],
        "book": book,
    }


class Change(BaseModel):
    old: object | None = None     # bisheriger Wert (None = neu)
    value: object | None = None   # neuer Wert (None = gilt nicht mehr)
    label: str | None = None
    comment: str | None = None    # z.B. „neue Nummer seit dem Umzug“ – steht beim Vorschlag


class Answer(BaseModel):
    name: str | None = None
    fields: dict[str, list[Change]] = {}
    message: str | None = None
    website: str | None = None    # Honigtopf gegen Bots
    book: dict[str, str] = {}     # Freundebuch-Antworten (werden direkt gespeichert – es sind ihre eigenen Worte)
    signature: str | None = None  # Unterschrift als PNG-Data-URL


def _clean(v):
    if isinstance(v, str):
        return v.strip()[:MAX_LEN] or None
    if isinstance(v, dict):
        out = {k: (x.strip()[:MAX_LEN] if isinstance(x, str) else x) for k, x in v.items() if k in
               ("street", "zip", "city", "country", "service", "handle", "id", "url")}
        return out if any(out.values()) else None
    return None


@router.post("/api/v1/public/update/{token}", include_in_schema=False)
def public_answer(token: str, body: Answer):
    l = _by_token(token)
    if body.website:
        return {"ok": True}
    if l["answers"] >= MAX_ANSWERS:
        raise HTTPException(429, "Über diesen Link kam schon sehr viel – bitte melde dich direkt.")
    uid, eid = l["user_id"], l["entity_id"]
    e = model.get_entity(uid, eid)
    who = e["name"] or "Die Person"
    why = f"{who} hat das selbst angegeben"
    allowed = {d["id"]: d for d in _defs(uid, db.jl(l["fields"], []))}
    cur = model.get_values("entity", eid, include_deprecated=False)
    n = 0
    with db.tx():
        name = (body.name or "").strip()[:120]
        if name and name != (e["name"] or ""):
            n += bool(add_suggestion(uid, "name", eid, {"value": name, "why": why}, SOURCE))
        for fid, changes in body.fields.items():
            d = allowed.get(fid)
            if not d:
                continue
            have = [v["value"] for v in cur.get(fid, [])]
            for c in changes[:MAX_PER_FIELD]:
                old, new = _clean(c.old), _clean(c.value)
                if d["type"] == "date" and new:
                    try:
                        if not model.normalize_value(uid, d, new):
                            continue
                    except Exception:
                        continue
                if old is not None and old not in have:
                    old = None                       # unbekannter alter Wert → wie neu behandeln
                if old is None and new is not None and new not in have:
                    p = {"field": fid, "value": new, "why": why}
                elif old is not None and new is not None and new != old:
                    p = {"field": fid, "value": new, "why": why, **({"replace_value": old} if d["multi"] else {})}
                elif old is not None and new is None and d["multi"]:
                    p = {"field": fid, "value": old, "deprecate_value": True, "why": f"{who}: gilt nicht mehr"}
                else:
                    continue
                if c.label and d["multi"]:
                    p["label"] = c.label.strip()[:40]
                comment = (c.comment or "").strip()[:200]
                if comment:  # Kommentar der Person zur Änderung – steht sichtbar beim Vorschlag
                    p["comment"] = comment
                    p["why"] = f"{p['why']}: „{comment}“"
                n += bool(add_suggestion(uid, "field", eid, p, SOURCE))
        # Freundebuch: direkt speichern (Quelle „selbst“, steht im Verlauf), nur die freigegebenen Fragen
        fb = 0
        if BOOK in db.jl(l["fields"], []):
            qs = {d["id"]: d for d in _book_defs(uid)}
            for fid, text in (body.book or {}).items():
                d = qs.get(fid)
                if not d or not isinstance(text, str):
                    continue
                text = text.strip()[:2000 if d["type"] == "note" else 200]
                old_v = (cur.get(fid) or [{}])[0].get("value")
                if text and text != old_v:
                    model.set_entity_field(uid, eid, fid, text, SOURCE)
                    fb += 1
            sig = body.signature or ""
            if sig.startswith("data:image/png;base64,") and len(sig) < 400_000:
                try:
                    from .dateien import store_bytes
                    fid_ = store_bytes(uid, base64.b64decode(sig.split(",", 1)[1]), "image/png")
                    model.set_entity_field(uid, eid, "f_fb_sign", f"/api/v1/files/{fid_}", SOURCE)
                    fb += 1
                except Exception:
                    pass
        msg = (body.message or "").strip()[:500]
        if n or msg or fb:
            db.insert("today_items", {"id": new_id("t"), "user_id": uid, "routine_id": None, "entity_id": eid, "kind": "card",
                                      "title": (f"{who} hat dein Freundebuch ausgefüllt" if fb else f"{who} hat die eigenen Angaben geprüft")
                                               + (f" – {n} Vorschl{'ag' if n == 1 else 'äge'}" if n else ""),
                                      "body": msg[:140], "day": now()[:10], "created_at": now(), "data": "{}"})
        db.ex("UPDATE update_links SET answers=answers+1, last_used_at=? WHERE id=?", now(), l["id"])
    return {"ok": True, "suggestions": n, "book": fb, "owner": display_name(model.get_entity(uid, model.self_id(uid)))}


@router.post("/api/v1/public/update/{token}/photo", include_in_schema=False)
async def public_photo(token: str, file: UploadFile = File(...), as_avatar: str | None = Form(None)):
    """Foto fürs Freundebuch: geht direkt nach Immich (Album „syn Freundebuch“). Ohne Immich gibt es keine Fotos."""
    l = _by_token(token)
    if BOOK not in db.jl(l["fields"], []):
        raise HTTPException(404, "Kein Freundebuch")
    from ..importers.immich import connected, upload_photo
    uid, eid = l["user_id"], l["entity_id"]
    if not connected(uid):
        raise HTTPException(404, "Fotos sind hier nicht möglich")
    mime = (file.content_type or "").lower()
    if not mime.startswith("image/"):
        raise HTTPException(400, "Bitte ein Bild")
    data = await file.read(15 * 1024 * 1024 + 1)
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Das Bild ist zu groß (höchstens 15 MB)")
    try:
        aid = upload_photo(uid, data, file.filename or "freundebuch.jpg", mime, eid)
    except Exception:
        raise HTTPException(502, "Das Foto konnte gerade nicht gespeichert werden") from None
    if not aid:
        raise HTTPException(404, "Fotos sind hier nicht möglich")
    model.set_entity_field(uid, eid, "f_fb_photo", f"/api/v1/immich/assets/{aid}?size=preview", SOURCE)
    if as_avatar in ("1", "true", "on"):  # „Auch als mein Profilbild vorschlagen“ – nur als Vorschlag
        who = model.get_entity(uid, eid)["name"] or "Die Person"
        add_suggestion(uid, "avatar", eid, {"value": "neues Profilbild", "asset": aid, "img": f"/api/v1/immich/assets/{aid}?size=thumbnail",
                                            "why": f"{who} schlägt sich selbst ein Profilbild vor"}, SOURCE)
    return {"ok": True}


def install(app):
    @app.get("/u/{token}", include_in_schema=False)
    def update_page(token: str):
        return FileResponse(config.WEB_DIR / "update.html", headers={"Cache-Control": "no-cache", "X-Robots-Tag": "noindex"})
