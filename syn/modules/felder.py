"""Felder: Basisfelder und eigene Felder pro Typ. Angesprochen wird immer die ID, nicht der Name."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db, model
from ..auth import Ctx, current
from ..model import FIELD_TYPES, Bad
from ..util import new_id, now

router = APIRouter(prefix="/api/v1", tags=["Felder"])

SCOPES = ("person", "pet", "both", "bund", "kreis")


@router.get("/fields")
def list_fields(ctx: Ctx = Depends(current)):
    return list(model.field_defs(ctx.uid).values())


class NewField(BaseModel):
    name: str
    type: str
    scope: str = "both"
    multi: bool = False
    options: dict = {}
    quick_action: str | None = None  # "today" | "plus1" | routine id | None


def _quick(ctx, d, qa):
    """Schnellaktion = Routine mit manuellem Auslöser."""
    if qa is None:
        return None
    if qa == "":
        return ""
    if qa in ("today", "plus1"):
        if qa == "today" and d["type"] != "date":
            raise Bad("„Auf heute setzen“ nur bei Datumsfeldern")
        if qa == "plus1" and d["type"] != "number":
            raise Bad("„+1“ nur bei Zahlenfeldern")
        rid = new_id("r")
        label = "Auf heute setzen" if qa == "today" else "+1"
        act = {"type": "set_today", "field": d["id"]} if qa == "today" else {"type": "increment", "field": d["id"],
                                                                              "by": 1}
        db.insert("routines", {"id": rid, "user_id": ctx.uid, "name": f"{d['name']}: {label}", "enabled": 1,
                               "trigger": db.jd({"type": "manual", "label": label,
                                                 "icon": "calendar" if qa == "today" else "plus"}),
                               "conditions": "[]", "actions": db.jd([act]), "created_at": now()})
        return rid
    r = db.q1("SELECT * FROM routines WHERE id=? AND user_id=?", qa, ctx.uid)
    if not r or db.jl(r["trigger"], {}).get("type") != "manual":
        raise Bad("Schnellaktion muss eine Routine mit manuellem Auslöser sein")
    return qa


@router.post("/fields")
def new_field(body: NewField, ctx: Ctx = Depends(current)):
    if body.type not in FIELD_TYPES:
        raise Bad(f"Feldtyp muss einer von {', '.join(FIELD_TYPES)} sein")
    if body.scope not in SCOPES:
        raise Bad(f"scope muss einer von {', '.join(SCOPES)} sein")
    fid = new_id("f", 4)
    n = db.val("SELECT COUNT(*) FROM field_defs WHERE user_id=?", ctx.uid)
    d = {"user_id": ctx.uid, "id": fid, "scope": body.scope, "name": body.name.strip(), "type": body.type,
         "options": db.jd(body.options), "multi": int(body.multi), "position": n, "is_base": 0}
    db.insert("field_defs", d)
    rid = _quick(ctx, {**d, "options": body.options}, body.quick_action)
    if rid:
        db.ex("UPDATE field_defs SET quick_routine_id=? WHERE user_id=? AND id=?", rid, ctx.uid, fid)
    return model.field_defs(ctx.uid)[fid]


@router.patch("/fields/{fid}")
def patch_field(fid: str, body: dict, ctx: Ctx = Depends(current)):
    d = model.fdef(ctx.uid, fid)
    upd = {}
    if "name" in body:
        upd["name"] = body["name"].strip()  # Umbenennen bricht nichts: Regeln nutzen die ID
    if "options" in body:
        upd["options"] = db.jd(body["options"])
    if "multi" in body:
        upd["multi"] = int(bool(body["multi"]))
    if "position" in body:
        upd["position"] = int(body["position"])
    if "scope" in body:
        if body["scope"] not in SCOPES:
            raise Bad("scope ungültig")
        if (d["scope"] in ("bund", "kreis")) != (body["scope"] in ("bund", "kreis")) and \
                db.val("SELECT 1 FROM field_values WHERE user_id=? AND field_id=?", ctx.uid, fid):
            raise Bad("Feld hat schon Werte und kann nicht zwischen Person/Bund/Kreis wechseln")
        upd["scope"] = body["scope"]
    if "type" in body and body["type"] != d["type"]:
        if db.val("SELECT 1 FROM field_values WHERE user_id=? AND field_id=?", ctx.uid, fid):
            raise Bad("Feldtyp kann nicht geändert werden, solange Werte existieren")
        upd["type"] = body["type"]
    if "quick_action" in body:
        rid = _quick(ctx, d, body["quick_action"])
        upd["quick_routine_id"] = rid or None
    db.update("field_defs", {"user_id": ctx.uid, "id": fid}, upd)
    return model.field_defs(ctx.uid)[fid]


@router.post("/fields/order")
def order(body: dict, ctx: Ctx = Depends(current)):
    for i, fid in enumerate(body.get("ids", [])):
        db.ex("UPDATE field_defs SET position=? WHERE user_id=? AND id=?", i, ctx.uid, fid)
    return {"ok": True}


@router.delete("/fields/{fid}")
def delete_field(fid: str, ctx: Ctx = Depends(current)):
    """Basisfelder lassen sich ebenso löschen. Die Werte verschwinden, der Verlauf bleibt."""
    model.fdef(ctx.uid, fid)
    if fid == "f_level" and ctx.settings.get("use_levels"):
        raise Bad("Ring wird benutzt – schalte zuerst die Ringe in den Einstellungen aus")
    refs = [r["name"] for r in db.q("SELECT name, trigger, conditions, actions FROM routines WHERE user_id=?",
                                    ctx.uid)
            if fid in (r["trigger"] or "") + (r["conditions"] or "") + (r["actions"] or "")]
    if refs:
        raise Bad(f"Feld wird in Routinen benutzt: {', '.join(refs)}")
    with db.tx():
        for v in db.q("SELECT * FROM field_values WHERE user_id=? AND field_id=?", ctx.uid, fid):
            model.record(ctx.uid, v["owner_type"], v["owner_id"], fid, db.jl(v["value"]), None, "Feld gelöscht",
                         v["id"])
        db.ex("DELETE FROM field_values WHERE user_id=? AND field_id=?", ctx.uid, fid)
        db.ex("DELETE FROM field_defs WHERE user_id=? AND id=?", ctx.uid, fid)
    return {"ok": True}


# ---------------------------------------------------------------- gelöschte Standardfelder wiederherstellen

def _standard():
    from ..seed import FIELDS, FREUNDEBUCH
    return {f[0]: f for f in FIELDS + FREUNDEBUCH}


def _deleted_values(uid, fid):
    """Werte aus der letzten Löschung des Feldes (der Verlauf hält jeden Wert mit „Feld gelöscht“ fest)."""
    last = db.val("SELECT MAX(at) FROM history WHERE user_id=? AND attr=? AND source='Feld gelöscht' AND new IS NULL", uid, fid)
    if not last:
        return []
    return db.q("SELECT * FROM history WHERE user_id=? AND attr=? AND source='Feld gelöscht' AND new IS NULL AND at=? ORDER BY id", uid, fid, last)


@router.get("/fields/standard/missing")
def missing_standard(ctx: Ctx = Depends(current)):
    have = {r["id"] for r in db.q("SELECT id FROM field_defs WHERE user_id=?", ctx.uid)}
    return [{"id": fid, "name": f[2], "type": f[3], "group": (f[4] or {}).get("group"), "values": len(_deleted_values(ctx.uid, fid))}
            for fid, f in _standard().items() if fid not in have]


@router.post("/fields/{fid}/restore")
def restore_standard(fid: str, ctx: Ctx = Depends(current)):
    f = _standard().get(fid)
    if not f:
        raise HTTPException(404, "Kein Standardfeld")
    if db.val("SELECT 1 FROM field_defs WHERE user_id=? AND id=?", ctx.uid, fid):
        raise Bad("Das Feld gibt es schon")
    _, scope, name, typ, opts, multi = f
    restored = 0
    with db.tx():
        pos = db.val("SELECT COALESCE(MAX(position), 0) + 1 FROM field_defs WHERE user_id=?", ctx.uid)
        db.insert("field_defs", {"user_id": ctx.uid, "id": fid, "scope": scope, "name": name, "type": typ,
                                 "options": db.jd(opts), "multi": multi, "position": pos, "is_base": 1})
        seen_owner = set()
        for h in _deleted_values(ctx.uid, fid):
            ot, oid = h["owner_type"], h["owner_id"]
            table = {"entity": "entities", "bund": "bunds", "circle": "circles"}.get(ot)
            if not table or not db.val(f"SELECT 1 FROM {table} WHERE id=?", oid):
                continue  # Person/Bund gibt es nicht mehr
            if not multi and (ot, oid) in seen_owner:
                continue
            vid = h["value_id"] if h["value_id"] and not db.val("SELECT 1 FROM field_values WHERE id=?", h["value_id"]) else new_id("v", 10)
            db.insert("field_values", {"id": vid, "user_id": ctx.uid, "owner_type": ot, "owner_id": oid, "field_id": fid,
                                       "value": h["old"], "is_primary": int((ot, oid) not in seen_owner), "source": "manual",
                                       "recorded_at": now(), "position": 0})
            model.record(ctx.uid, ot, oid, fid, None, db.jl(h["old"]), "Feld wiederhergestellt", vid)
            seen_owner.add((ot, oid))
            restored += 1
    return {"ok": True, "values": restored}


@router.get("/fields/{fid}/values")
def distinct_values(fid: str, ctx: Ctx = Depends(current)):
    """Vorhandene Werte eines Feldes (für Filter und Autovervollständigung)."""
    model.fdef(ctx.uid, fid)
    seen = {}
    for r in db.q("SELECT value FROM field_values WHERE user_id=? AND field_id=? AND deprecated=0", ctx.uid, fid):
        v = db.jl(r["value"])
        for x in (v if isinstance(v, list) else [v]):
            k = db.jd(x)
            seen[k] = seen.get(k, 0) + 1
    return [{"value": db.jl(k), "count": n} for k, n in sorted(seen.items(), key=lambda kv: -kv[1])]


@router.get("/services")
def services(ctx: Ctx = Depends(current)):
    return ctx.settings.get("services", [])


@router.put("/services")
def put_services(body: list[dict], ctx: Ctx = Depends(current)):
    """Dienste fürs Profil-Feld als bearbeitbare Liste mit Link-Vorlage ({handle}, {id}, {url})."""
    for s in body:
        if not s.get("id") or not s.get("name"):
            raise Bad("Jeder Dienst braucht id und name")
    from .konten import patch_settings
    patch_settings({"services": body}, ctx)
    return body
