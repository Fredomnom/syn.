"""Eigene Importer: Kontakte werden nicht abgerufen, sondern per API geschickt (Push).

Ein eigener Importer verhält sich danach genau wie ein eingebauter: gleiche Zuordnung (Profil-ID, Nummer,
E-Mail, auf Wunsch Name), gleiche Import-Sperren, Quellen, Vorschläge, Gruppen-Vorschläge, Status und Protokoll.
Nur der Weg ist umgekehrt: dein Skript schickt `POST /api/v1/importers/custom/{id}/push` mit einer Liste Kontakte.
"""
import base64
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..auth import Ctx, current
from ..importe import Contact, Importer, Run, apply_contacts
from ..model import Bad
from ..util import now

router = APIRouter(prefix="/api/v1", tags=["Eigene Importer"])

PREFIX = "x_"


class PushImporter(Importer):
    """Wie ein eingebauter Importer – nur ohne fetch(): die Kontakte kommen per Push."""
    official = "eigener Importer"
    way = "Push über die API"

    def __init__(self, row):
        self.id, self.name = row["id"], row["name"]
        self.service = row.get("service") or None
        self.brings = row.get("description") or "Was dein Skript schickt"
        self.match_by_name = bool(row.get("match_by_name"))

    def fetch(self, cfg, run):  # pragma: no cover – wird nie abgerufen
        raise RuntimeError("Eigene Importer werden nicht abgerufen, sondern per Push gefüllt")


def custom_rows(uid):
    return db.q("SELECT * FROM custom_importers WHERE user_id=? ORDER BY name", uid)


def custom_importer(uid, iid):
    r = db.q1("SELECT * FROM custom_importers WHERE user_id=? AND id=?", uid, iid)
    return PushImporter(r) if r else None


def _row(uid, iid):
    r = db.q1("SELECT * FROM custom_importers WHERE user_id=? AND id=?", uid, iid)
    if not r:
        raise HTTPException(404, "Eigener Importer nicht gefunden")
    return r


def _out(uid, r):
    c = db.q1("SELECT * FROM importer_configs WHERE user_id=? AND importer_id=?", uid, r["id"]) or {}
    return {"id": r["id"], "name": r["name"], "service": r["service"], "description": r["description"],
            "match_by_name": bool(r["match_by_name"]), "created_at": r["created_at"], "push": True,
            "push_url": f"/api/v1/importers/custom/{r['id']}/push",
            "last_run_at": c.get("last_run_at"), "last_status": c.get("last_status"), "last_log": c.get("last_log")}


class NewCustom(BaseModel):
    name: str = Field(..., description="Anzeigename, z.B. „Vereinsliste“")
    id: str | None = Field(None, description="Kurz-ID (a–z, 0–9, _). Ohne: aus dem Namen. Bekommt immer das Präfix x_")
    service: str | None = Field(None, description="Dienst fürs Profil-Feld (z.B. „vereinsheim“). Ohne: die Importer-ID")
    description: str | None = Field(None, description="Was reinkommt – steht in den Einstellungen")
    match_by_name: bool = Field(False, description="Eindeutige Namen ordnen zu (nur, wenn die Namen von dir stammen)")


@router.get("/importers/custom", summary="Eigene Importer auflisten")
def list_custom(ctx: Ctx = Depends(current)):
    return [_out(ctx.uid, r) for r in custom_rows(ctx.uid)]


@router.post("/importers/custom", summary="Eigenen Importer anlegen")
def new_custom(body: NewCustom, ctx: Ctx = Depends(current)):
    name = body.name.strip()
    if not name:
        raise Bad("Name fehlt")
    slug = re.sub(r"[^a-z0-9_]+", "_", (body.id or name).lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")).strip("_")[:30]
    if not slug:
        raise Bad("ID: Buchstaben, Ziffern oder _")
    iid = slug if slug.startswith(PREFIX) else PREFIX + slug
    if db.val("SELECT 1 FROM custom_importers WHERE user_id=? AND id=?", ctx.uid, iid):
        raise HTTPException(409, f"Die ID {iid} gibt es schon")
    with db.tx():
        db.insert("custom_importers", {"user_id": ctx.uid, "id": iid, "name": name[:80], "service": (body.service or "").strip() or None,
                                       "description": (body.description or "").strip()[:300] or None,
                                       "match_by_name": int(body.match_by_name), "created_at": now()})
        if not db.val("SELECT 1 FROM importer_configs WHERE user_id=? AND importer_id=?", ctx.uid, iid):
            db.insert("importer_configs", {"user_id": ctx.uid, "importer_id": iid, "enabled": 1, "state": "{}"})
    return _out(ctx.uid, _row(ctx.uid, iid))


@router.patch("/importers/custom/{iid}", summary="Eigenen Importer ändern")
def patch_custom(iid: str, body: dict, ctx: Ctx = Depends(current)):
    _row(ctx.uid, iid)
    upd = {}
    for k in ("name", "service", "description"):
        if k in body:
            upd[k] = (body[k] or "").strip() or None
    if "match_by_name" in body:
        upd["match_by_name"] = int(bool(body["match_by_name"]))
    if upd.get("name") is None and "name" in upd:
        raise Bad("Name fehlt")
    if upd:
        db.update("custom_importers", {"user_id": ctx.uid, "id": iid}, upd)
    return _out(ctx.uid, _row(ctx.uid, iid))


@router.delete("/importers/custom/{iid}", summary="Eigenen Importer löschen (importierte Werte bleiben)")
def delete_custom(iid: str, ctx: Ctx = Depends(current)):
    _row(ctx.uid, iid)
    db.ex("DELETE FROM custom_importers WHERE user_id=? AND id=?", ctx.uid, iid)
    db.ex("DELETE FROM importer_configs WHERE user_id=? AND importer_id=?", ctx.uid, iid)
    return {"ok": True}


class PushContact(BaseModel):
    """Ein Kontakt – dieselben Angaben, die eingebaute Importer liefern."""
    service_id: str | None = Field(None, description="Stabile ID der Person in deiner Quelle (wichtigster Schlüssel)")
    name: str | None = None
    handle: str | None = None
    url: str | None = None
    phones: list = Field(default_factory=list, description="Nummern oder [Nummer, Label]")
    emails: list = Field(default_factory=list)
    birthday: str | None = Field(None, description="JJJJ-MM-TT oder --MM-TT")
    avatar_url: str | None = None
    avatar_base64: str | None = Field(None, description="Profilbild als Base64 (statt avatar_url)")
    friend_since: str | None = None
    last_contact: str | None = None
    seen: str | None = None
    fields: dict = Field(default_factory=dict, description="Feld-ID → Wert, z.B. {\"f_company\": \"ACME\"}")
    service: str | None = Field(None, description="Dienst fürs Profil-Feld, falls abweichend")
    only_existing: bool = False
    groups: list = Field(default_factory=list, description="Gruppen, in denen die Person ist (→ Kreis-Vorschläge)")
    note: str | None = None
    bot: bool = False
    description: str | None = None


class Push(BaseModel):
    contacts: list[PushContact] = Field(..., description="Höchstens 5000 je Aufruf")


@router.post("/importers/custom/{iid}/push", summary="Kontakte an einen eigenen Importer schicken")
def push(iid: str, body: Push, ctx: Ctx = Depends(current)):
    imp = PushImporter(_row(ctx.uid, iid))
    if len(body.contacts) > 5000:
        raise Bad("Höchstens 5000 Kontakte je Aufruf – bitte aufteilen")
    contacts = []
    for c in body.contacts:
        d = c.model_dump()
        b64 = d.pop("avatar_base64", None)
        k = Contact(**d)
        if b64:
            try:
                k.avatar_bytes = base64.b64decode(b64.split(",", 1)[-1])[:8_000_000]
            except Exception:
                raise Bad("avatar_base64 ist kein gültiges Base64") from None
        contacts.append(k)
    cfg = db.q1("SELECT * FROM importer_configs WHERE user_id=? AND importer_id=?", ctx.uid, iid)
    state = db.jl(cfg["state"], {}) if cfg else {}
    run = Run(ctx, imp, None, state, {})
    try:
        run.log(f"{len(contacts)} Kontakte per Push erhalten")
        stats = apply_contacts(ctx, imp, contacts, run)
        status = (f"{stats['seen']} gelesen, {stats['new']} neu, {stats['matched']} erkannt, {stats['values']} Werte, "
                  f"{stats['suggestions']} Vorschläge" + (f", {stats['blocked']} gesperrt übersprungen" if stats.get("blocked") else ""))
    except Exception as e:
        status = f"Fehler: {e}"
        run.log(status)
        stats = None
    finally:
        run.http.close()
    run.log(status)
    db.ex("UPDATE importer_configs SET last_run_at=?, last_status=?, last_log=?, state=? WHERE user_id=? AND importer_id=?",
          now(), status, "\n".join(run.lines[-200:]), db.jd(run.state), ctx.uid, iid)
    if stats is None:
        raise HTTPException(500, status)
    return {"ok": True, "status": status, "stats": stats}
