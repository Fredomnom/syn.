"""Visitenkarte: deine Profilangaben als kurzer öffentlicher Link (/@name).

Wer den Link öffnet, sieht, was du teilst, und kann eigene Angaben zurückschicken.
Die landen als neue Person mit der Quelle „Visitenkarte“ (ohne Konto, ohne Anmeldung).
"""
import re
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response

from .. import config, db, model
from ..auth import Ctx, current
from ..model import Bad, display_name
from ..util import new_id, now

router = APIRouter(prefix="/api/v1", tags=["Visitenkarte"])

SLUG = re.compile(r"^[a-z0-9][a-z0-9_.-]{1,30}$")
RESERVED = {"api", "static", "login", "admin", "settings", "card", "sw.js", "help", "about", "www"}
# Was der Gegenüber ausfüllen darf (Feld-ID → Pflicht?)
ASK_DEFAULT = ["f_phone", "f_email", "f_profile", "f_bday", "f_city"]
SHARE_DEFAULT = ["f_phone", "f_email", "f_profile"]
SOURCE = "card"


def _card(uid):
    c = db.q1("SELECT * FROM cards WHERE user_id=?", uid)
    if not c:
        u = db.q1("SELECT username FROM users WHERE id=?", uid)
        base = re.sub(r"[^a-z0-9_.-]", "", (u["username"] or "ich").lower())[:30] or "ich"
        slug, n = base if len(base) > 1 else base + "1", 2
        while db.val("SELECT 1 FROM cards WHERE slug=?", slug) or slug in RESERVED:
            slug, n = f"{base}{n}", n + 1
        db.insert("cards", {"user_id": uid, "slug": slug, "enabled": 0, "fields": db.jd(SHARE_DEFAULT),
                            "ask": db.jd(ASK_DEFAULT), "intro": None, "created_at": now(), "updated_at": now()})
        c = db.q1("SELECT * FROM cards WHERE user_id=?", uid)
    return {**c, "enabled": bool(c["enabled"]), "fields": db.jl(c["fields"], []), "ask": db.jl(c["ask"], []),
            "path": "/@" + c["slug"]}


@router.get("/card")
def my_card(ctx: Ctx = Depends(current)):
    """Deine Visitenkarte (wird beim ersten Aufruf angelegt, aber noch nicht freigeschaltet)."""
    return _card(ctx.uid)


@router.patch("/card")
def patch_card(body: dict, ctx: Ctx = Depends(current)):
    _card(ctx.uid)
    upd = {}
    if "slug" in body:
        s = (body["slug"] or "").strip().lower().lstrip("@")
        if not SLUG.match(s) or s in RESERVED:
            raise Bad("2–31 Zeichen: Kleinbuchstaben, Ziffern, Punkt, Strich, Unterstrich")
        if db.val("SELECT 1 FROM cards WHERE slug=? AND user_id<>?", s, ctx.uid):
            raise HTTPException(409, "Dieser Link ist schon vergeben")
        upd["slug"] = s
    if "enabled" in body:
        upd["enabled"] = int(bool(body["enabled"]))
    for k in ("fields", "ask"):
        if k in body:
            if not isinstance(body[k], list):
                raise Bad(f"{k} muss eine Liste sein")
            upd[k] = db.jd([str(x) for x in body[k]][:30])
    if "intro" in body:
        upd["intro"] = (body["intro"] or "").strip()[:280] or None
    upd["updated_at"] = now()
    db.update("cards", {"user_id": ctx.uid}, upd)
    return _card(ctx.uid)


def _public(slug):
    c = db.q1("SELECT * FROM cards WHERE slug=? AND enabled=1", (slug or "").lower())
    if not c:
        raise HTTPException(404, "Diese Visitenkarte gibt es nicht")
    return c


@router.get("/public/cards/{slug}", tags=["Visitenkarte"])
def public_card(slug: str):
    """Öffentlich: was auf der Visitenkarte steht (ohne Anmeldung)."""
    c = _public(slug)
    uid = c["user_id"]
    me = model.get_entity(uid, model.self_id(uid))
    defs = model.field_defs(uid)
    vals = model.get_values("entity", me["id"], include_deprecated=False)
    from ..auth import user_settings
    services = [{k: s.get(k) for k in ("id", "name", "link")} for s in user_settings(uid).get("services", [])]
    shown = []
    for fid in db.jl(c["fields"], []):
        d = defs.get(fid)
        if not d or not vals.get(fid):
            continue
        shown.append({"id": fid, "name": d["name"], "type": d["type"],
                      "values": [{"value": v["value"], "label": v.get("label")} for v in vals[fid]]})
    ask = [{"id": fid, "name": defs[fid]["name"], "type": defs[fid]["type"]}
           for fid in db.jl(c["ask"], []) if fid in defs and defs[fid]["scope"] in ("person", "both")
           and defs[fid]["type"] in ("text", "phone", "email", "date", "profile", "address", "url", "choice")]
    return {"slug": c["slug"], "name": display_name(me), "first_name": me.get("first_name"),
            "avatar": f"/api/v1/public/cards/{c['slug']}/avatar" if me.get("avatar") else None,
            "intro": c["intro"], "fields": shown, "ask": ask, "services": services}


@router.get("/public/cards/{slug}/avatar", include_in_schema=False)
def public_avatar(slug: str):
    c = _public(slug)
    me = model.get_entity(c["user_id"], model.self_id(c["user_id"]))
    m = re.match(r"^/api/v1/files/(\w+)$", me.get("avatar") or "")
    if not m:
        raise HTTPException(404)
    from .dateien import read_bytes
    data, mime = read_bytes(c["user_id"], m.group(1))
    if not data:
        raise HTTPException(404)
    return Response(data, media_type=mime, headers={"Cache-Control": "public, max-age=300"})


_HITS: dict = {}


def _limit(ip):
    """Einfache Bremse gegen Spam: höchstens 5 Antworten je Adresse und Stunde."""
    t = time.time()
    hits = [x for x in _HITS.get(ip, []) if t - x < 3600]
    if len(hits) >= 5:
        raise HTTPException(429, "Zu viele Antworten – bitte später nochmal")
    _HITS[ip] = hits + [t]


@router.post("/public/cards/{slug}/reply", tags=["Visitenkarte"])
def reply(slug: str, body: dict, request: Request):
    """Öffentlich: jemand schickt seine eigenen Angaben zurück. Er wird zur neuen Person mit Quelle „Visitenkarte“."""
    c = _public(slug)
    if body.get("website"):  # Honigtopf-Feld – Menschen sehen es nicht
        return {"ok": True}
    _limit(request.client.host if request.client else "?")
    uid = c["user_id"]
    name = (body.get("name") or "").strip()[:120]
    if not name:
        raise Bad("Bitte gib deinen Namen an")
    defs = model.field_defs(uid)
    allowed = set(db.jl(c["ask"], []))
    msg = (body.get("message") or "").strip()[:1000]
    with db.tx():
        eid = model.create_entity(uid, name=name, source=SOURCE)
        for fid, v in (body.get("fields") or {}).items():
            if fid not in allowed or fid not in defs or v in (None, "", {}):
                continue
            # mehrere Werte (z.B. Profile) als Liste
            for x in (v if isinstance(v, list) else [v])[:10]:
                if isinstance(x, str):
                    x = x.strip()[:300]
                if x in (None, "", {}):
                    continue
                try:
                    model.add_value(uid, "entity", eid, defs[fid], x, source=SOURCE)
                except Exception:
                    pass  # ungültige Eingabe einfach weglassen
        if "f_via" in defs:
            model.set_single(uid, "entity", eid, defs["f_via"], {"type": "service", "id": SOURCE}, source=SOURCE)
        if msg and "f_note" in defs:
            model.set_single(uid, "entity", eid, defs["f_note"], msg, source=SOURCE)
        db.insert("today_items", {"id": new_id("t"), "user_id": uid, "routine_id": None, "entity_id": eid,
                                  "kind": "card", "title": f"{name} hat dir über deine Visitenkarte geschrieben",
                                  "body": msg[:140], "day": now()[:10], "created_at": now(), "data": "{}"})
    return {"ok": True, "to": display_name(model.get_entity(uid, model.self_id(uid)))}


def install(app):
    """Kurzer öffentlicher Link: /@name zeigt die Visitenkarte."""
    @app.get("/@{slug}", include_in_schema=False)
    def card_page(slug: str):
        return FileResponse(config.WEB_DIR / "card.html", headers={"Cache-Control": "no-cache"})
