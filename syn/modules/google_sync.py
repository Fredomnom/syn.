"""Optionaler Sync zu Google Kontakte (für alle, die kein CardDAV am Handy einrichten wollen).

Es gelten dieselben Regeln für „wer“ und „was“ wie beim CardDAV-Sync. syn bleibt die führende Quelle:
Änderungen aus Google kommen als Vorschlag zurück und überschreiben nichts direkt. Neue Kontakte aus Google
landen unter „Lose“.

Einrichtung: eigener OAuth-Client in der Google Cloud Console (Typ Webanwendung), Weiterleitungs-URI:
  <deine syn-Adresse>/api/v1/google/callback
"""
import base64
import hashlib
import secrets
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from .. import auth, crypto, db, model, sync_rules
from ..auth import Ctx, current
from ..model import Bad
from ..util import new_id, normalize_email, normalize_phone, now

router = APIRouter(prefix="/api/v1", tags=["Google"])
KEY = "_google"
SCOPES = "https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/calendar.readonly"
API = "https://people.googleapis.com/v1"


def _cfg(uid):
    row = db.q1("SELECT * FROM importer_configs WHERE user_id=? AND importer_id=?", uid, KEY)
    return (crypto.unseal(uid, row["config_enc"], {}) if row else {}), (db.jl(row["state"], {}) if row else {})


def _save(uid, cfg=None, state=None):
    if not db.val("SELECT 1 FROM importer_configs WHERE user_id=? AND importer_id=?", uid, KEY):
        db.insert("importer_configs", {"user_id": uid, "importer_id": KEY, "enabled": 0, "state": "{}"})
    if cfg is not None:
        db.ex("UPDATE importer_configs SET config_enc=? WHERE user_id=? AND importer_id=?", crypto.seal(uid, cfg), uid,
              KEY)
    if state is not None:
        db.ex("UPDATE importer_configs SET state=? WHERE user_id=? AND importer_id=?", db.jd(state), uid, KEY)


def _redirect_uri(request: Request, ctx):
    host = (ctx.settings.get("public_host") or "").rstrip("/")
    if host:
        return (host if host.startswith("http") else "https://" + host) + "/api/v1/google/callback"
    return str(request.base_url).rstrip("/") + "/api/v1/google/callback"


def access_token(ctx) -> str:
    cfg, _ = _cfg(ctx.uid)
    if not cfg.get("refresh_token"):
        raise RuntimeError("Google ist nicht verbunden (Einstellungen → Sync)")
    if cfg.get("access_token") and cfg.get("expires", 0) > time.time() + 60:
        return cfg["access_token"]
    r = httpx.post("https://oauth2.googleapis.com/token", data={
        "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
        "refresh_token": cfg["refresh_token"], "grant_type": "refresh_token"}, timeout=20)
    r.raise_for_status()
    j = r.json()
    cfg["access_token"] = j["access_token"]
    cfg["expires"] = time.time() + j.get("expires_in", 3600)
    _save(ctx.uid, cfg)
    return cfg["access_token"]


@router.get("/google")
def status(request: Request, ctx: Ctx = Depends(current)):
    cfg, state = _cfg(ctx.uid)
    row = db.q1("SELECT enabled, last_run_at, last_status FROM importer_configs WHERE user_id=? AND importer_id=?",
                ctx.uid, KEY) or {}
    return {"configured": bool(cfg.get("client_id")), "connected": bool(cfg.get("refresh_token")),
            "sync_enabled": bool(row.get("enabled")), "last_sync": row.get("last_run_at"),
            "last_status": row.get("last_status"), "redirect_uri": _redirect_uri(request, ctx),
            "mapped": db.val("SELECT COUNT(*) FROM google_map WHERE user_id=?", ctx.uid)}


@router.put("/google")
def configure(body: dict, request: Request, ctx: Ctx = Depends(current)):
    cfg, _ = _cfg(ctx.uid)
    for k in ("client_id", "client_secret"):
        if body.get(k) and not str(body[k]).startswith("••"):
            cfg[k] = body[k].strip()
    _save(ctx.uid, cfg)
    if "sync_enabled" in body:
        if body["sync_enabled"] and not cfg.get("refresh_token"):
            raise Bad("Erst mit Google verbinden")
        db.ex("UPDATE importer_configs SET enabled=? WHERE user_id=? AND importer_id=?", int(body["sync_enabled"]),
              ctx.uid, KEY)
        r = db.q1("SELECT id FROM routines WHERE user_id=? AND system='google'", ctx.uid)
        if body["sync_enabled"] and not r:
            db.insert("routines", {"id": new_id("r"), "user_id": ctx.uid, "name": "Sync: Google Kontakte",
                                   "enabled": 1, "trigger": db.jd({"type": "schedule", "every": "hourly"}),
                                   "conditions": "[]", "actions": db.jd([{"type": "google_sync"}]),
                                   "created_at": now(), "system": "google"})
        elif not body["sync_enabled"] and r:
            db.ex("DELETE FROM routines WHERE id=?", r["id"])
    return status(request, ctx)


@router.get("/google/auth-url")
def auth_url(request: Request, ctx: Ctx = Depends(current)):
    cfg, _ = _cfg(ctx.uid)
    if not cfg.get("client_id"):
        raise Bad("Erst Client-ID und Client-Secret eintragen")
    st = secrets.token_urlsafe(24)
    db.ex("INSERT OR REPLACE INTO instance(key,value) VALUES(?,?)", "oauth:" + st,
          db.jd({"uid": ctx.uid, "exp": time.time() + 900, "redirect": _redirect_uri(request, ctx)}))
    q = {"client_id": cfg["client_id"], "redirect_uri": _redirect_uri(request, ctx), "response_type": "code",
         "scope": SCOPES, "access_type": "offline", "prompt": "consent", "state": st}
    return {"url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(q)}


@router.get("/google/callback")
def callback(code: str = "", state: str = "", error: str = ""):
    s = db.jl(db.val("SELECT value FROM instance WHERE key=?", "oauth:" + state), None)
    db.ex("DELETE FROM instance WHERE key=?", "oauth:" + state)
    if error or not s or s["exp"] < time.time():
        return RedirectResponse("/#/settings/sync?google=fehler")
    uid = s["uid"]
    cfg, _ = _cfg(uid)
    r = httpx.post("https://oauth2.googleapis.com/token", data={
        "code": code, "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
        "redirect_uri": s["redirect"], "grant_type": "authorization_code"}, timeout=20)
    if r.status_code != 200:
        return RedirectResponse("/#/settings/sync?google=fehler")
    j = r.json()
    cfg.update({"refresh_token": j.get("refresh_token") or cfg.get("refresh_token"),
                "access_token": j["access_token"], "expires": time.time() + j.get("expires_in", 3600)})
    _save(uid, cfg)
    return RedirectResponse("/#/settings/sync?google=ok")


@router.delete("/google")
def disconnect(ctx: Ctx = Depends(current)):
    db.ex("DELETE FROM importer_configs WHERE user_id=? AND importer_id=?", ctx.uid, KEY)
    db.ex("DELETE FROM google_map WHERE user_id=?", ctx.uid)
    db.ex("DELETE FROM routines WHERE user_id=? AND system='google'", ctx.uid)
    return {"ok": True}


@router.post("/google/sync")
def sync_now(ctx: Ctx = Depends(current)):
    return {"status": sync(ctx)}


# ---------------------------------------------------------------- Abgleich

def _phonebook(ctx, row):
    vals = model.get_values("entity", row["id"], include_deprecated=False)
    bday = model.primary(vals.get("f_bday"))
    return {"name": row["name"] or row["description"] or "Ohne Namen",
            "phones": [[v["value"], v["label"]] for v in vals.get("f_phone", [])],
            "emails": [[v["value"], v["label"]] for v in vals.get("f_email", [])],
            "bday": bday["value"] if bday else None, "avatar": row["avatar"], "id": row["id"]}


def _person_body(ctx, pb):
    host = (ctx.settings.get("public_host") or "").rstrip("/")
    if host and not host.startswith("http"):
        host = "https://" + host
    t = {"privat": "home", "Arbeit": "work", "mobil": "mobile"}
    body = {"names": [{"unstructuredName": pb["name"]}],
            "phoneNumbers": [{"value": v, "type": t.get(lab or "", "mobile")} for v, lab in pb["phones"]],
            "emailAddresses": [{"value": v, "type": t.get(lab or "", "home")} for v, lab in pb["emails"]]}
    if pb["bday"]:
        from ..util import date_parts
        y, m, d, season = date_parts(pb["bday"])
        if m and d and not season:
            body["birthdays"] = [{"date": {**({"year": y} if y else {}), "month": m, "day": d}}]
    if host:
        body["urls"] = [{"value": f"{host}/#/p/{pb['id']}", "type": "syn"}]
    return body


def _hash(pb):
    return hashlib.sha1(db.jd(pb).encode()).hexdigest()


def sync(ctx) -> str:
    try:
        tok = access_token(ctx)
    except Exception as e:
        return f"Fehler: {e}"
    h = {"Authorization": f"Bearer {tok}"}
    c = httpx.Client(timeout=30, headers=h)
    uid = ctx.uid
    stats = {"neu": 0, "geändert": 0, "entfernt": 0, "vorschläge": 0, "neu aus Google": 0}
    _, state = _cfg(uid)
    try:
        # 1. Änderungen aus Google holen (als Vorschlag)
        pull(ctx, c, state, stats)
        # 2. syn → Google
        rows = {r["id"]: r for r in sync_rules.synced_rows(ctx)}
        maps = {m["entity_id"]: m for m in db.q("SELECT * FROM google_map WHERE user_id=?", uid)}
        fields = "names,phoneNumbers,emailAddresses,birthdays,urls"
        for eid, row in rows.items():
            pb = _phonebook(ctx, row)
            hsh = _hash(pb)
            m = maps.get(eid)
            if m and m["pushed_hash"] == hsh:
                continue
            body = _person_body(ctx, pb)
            if m:
                cur = c.get(f"{API}/{m['resource_name']}", params={"personFields": "metadata"})
                if cur.status_code == 404:
                    m = None
                else:
                    cur.raise_for_status()
                    body["etag"] = cur.json()["etag"]
                    r = c.patch(f"{API}/{m['resource_name']}:updateContact", params={"updatePersonFields": fields},
                                json=body)
                    r.raise_for_status()
                    stats["geändert"] += 1
            if not m:
                r = c.post(f"{API}/people:createContact", json=body)
                r.raise_for_status()
                rn = r.json()["resourceName"]
                db.ex("INSERT OR REPLACE INTO google_map(user_id,entity_id,resource_name,etag,pushed_hash,pushed) "
                      "VALUES(?,?,?,?,?,?)", uid, eid, rn, r.json().get("etag"), hsh, db.jd(pb))
                stats["neu"] += 1
                m = {"resource_name": rn, "pushed": None}
            else:
                db.ex("UPDATE google_map SET pushed_hash=?, pushed=? WHERE user_id=? AND entity_id=?", hsh, db.jd(pb),
                      uid, eid)
            old_av = (db.jl(maps[eid]["pushed"], {}) or {}).get("avatar") if eid in maps else None
            if pb["avatar"] and pb["avatar"] != old_av and pb["avatar"].startswith("/api/v1/files/"):
                from .dateien import read_bytes
                data, _ = read_bytes(uid, pb["avatar"].rsplit("/", 1)[1])
                if data:
                    c.patch(f"{API}/{m['resource_name']}:updateContactPhoto",
                            json={"photoBytes": base64.b64encode(data).decode()})
        # 3. Wer nicht mehr aufs Handy soll, verschwindet aus Google
        for eid, m in maps.items():
            if eid not in rows:
                r = c.delete(f"{API}/{m['resource_name']}:deleteContact")
                if r.status_code in (200, 404):
                    db.ex("DELETE FROM google_map WHERE user_id=? AND entity_id=?", uid, eid)
                    stats["entfernt"] += 1
        status = ", ".join(f"{v} {k}" for k, v in stats.items())
    except httpx.HTTPStatusError as e:
        status = f"Fehler: HTTP {e.response.status_code}: {e.response.text[:200]}"
    except Exception as e:
        status = f"Fehler: {e}"
    finally:
        c.close()
    db.ex("UPDATE importer_configs SET last_run_at=?, last_status=? WHERE user_id=? AND importer_id=?", now(), status,
          uid, KEY)
    return status


def pull(ctx, c, state, stats):
    from .vorschlaege import add_suggestion
    from ..importers.google_kontakte import person_to_contact
    uid = ctx.uid
    country = ctx.settings.get("country_code", "49")
    params = {"personFields": "names,phoneNumbers,emailAddresses,birthdays,metadata", "pageSize": 1000,
              "requestSyncToken": "true"}
    if state.get("sync_token"):
        params["syncToken"] = state["sync_token"]
    by_rn = {m["resource_name"]: m for m in db.q("SELECT * FROM google_map WHERE user_id=?", uid)}
    first_run = not state.get("sync_token")
    page = None
    while True:
        if page:
            params["pageToken"] = page
        r = c.get(f"{API}/people/me/connections", params=params)
        if r.status_code == 410:  # Sync-Token abgelaufen
            state.pop("sync_token", None)
            params.pop("syncToken", None)
            first_run = True
            continue
        r.raise_for_status()
        j = r.json()
        for p in j.get("connections", []):
            rn = p["resourceName"]
            m = by_rn.get(rn)
            if p.get("metadata", {}).get("deleted"):
                continue
            gc = person_to_contact(p)
            if not m:
                if first_run:
                    continue  # bestehende Google-Kontakte holt der Importer „Google Kontakte“, nicht der Sync
                eid = model.create_entity(uid, name=gc.name or "Aus Google", source="Google Kontakte")
                model.patch_entity(uid, eid, {"on_phone": True}, "Google Kontakte")
                for v, lab in gc.phones:
                    model.add_value(uid, "entity", eid, model.fdef(uid, "f_phone"), v, "Google Kontakte", lab)
                for v, lab in gc.emails:
                    model.add_value(uid, "entity", eid, model.fdef(uid, "f_email"), v, "Google Kontakte", lab)
                db.ex("INSERT OR REPLACE INTO google_map(user_id,entity_id,resource_name,etag,pushed_hash,pushed) "
                      "VALUES(?,?,?,?,?,?)", uid, eid, rn, p.get("etag"), "", None)
                stats["neu aus Google"] += 1
                continue
            pushed = db.jl(m["pushed"], {}) or {}
            eid = m["entity_id"]
            if gc.name and pushed.get("name") and gc.name != pushed["name"]:
                if add_suggestion(uid, "name", eid, {"value": gc.name, "why": "in Google geändert"}, "Google"):
                    stats["vorschläge"] += 1
            for kind, items, norm in (("f_phone", gc.phones, lambda x: normalize_phone(x, country)),
                                      ("f_email", gc.emails, normalize_email)):
                known = {norm(v) for v, _ in pushed.get("phones" if kind == "f_phone" else "emails", [])}
                for v, lab in items:
                    if norm(v) not in known:
                        if add_suggestion(uid, "field", eid, {"field": kind, "value": v, "label": lab,
                                                              "why": "in Google hinzugefügt"}, "Google"):
                            stats["vorschläge"] += 1
            if gc.birthday and gc.birthday != pushed.get("bday"):
                if add_suggestion(uid, "field", eid, {"field": "f_bday", "value": gc.birthday,
                                                      "why": "in Google geändert"}, "Google"):
                    stats["vorschläge"] += 1
        page = j.get("nextPageToken")
        if not page:
            state["sync_token"] = j.get("nextSyncToken")
            break
    _save(uid, state=state)


def run_for(ctx):
    return sync(ctx)
