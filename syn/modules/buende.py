"""Bünde: Beziehung zwischen genau zwei Lebewesen. Dazu Bund-Arten."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db, model
from ..auth import Ctx, current
from ..model import Bad
from ..util import new_id, now, parse_date

router = APIRouter(prefix="/api/v1", tags=["Bünde"])


class NewBund(BaseModel):
    a_id: str
    b_id: str
    kind_id: str | None = None
    role_a: str | None = None
    role_b: str | None = None
    valid_from: str | None = None
    fields: dict = {}


def bund_out(uid, b):
    return {**b, "fields": model.get_values("bund", b["id"])}


def create_bund(uid, a_id, b_id, kind_id=None, role_a=None, role_b=None, valid_from=None, source="manual"):
    if a_id == b_id:
        raise Bad("Ein Bund braucht zwei verschiedene Lebewesen")
    model.get_entity(uid, a_id)
    model.get_entity(uid, b_id)
    if db.val("SELECT 1 FROM bunds WHERE user_id=? AND ((a_id=? AND b_id=?) OR (a_id=? AND b_id=?))",
              uid, a_id, b_id, b_id, a_id):
        raise HTTPException(409, "Diese beiden haben schon einen Bund")
    k = db.q1("SELECT * FROM bund_kinds WHERE user_id=? AND id=?", uid, kind_id) if kind_id else None
    if kind_id and not k:
        raise Bad("Bund-Art unbekannt")
    bid = new_id("b")
    db.insert("bunds", {"id": bid, "user_id": uid, "a_id": a_id, "b_id": b_id, "kind_id": kind_id,
                        "role_a": role_a or (k and k["role_a"]), "role_b": role_b or (k and k["role_b"]),
                        "valid_from": parse_date(valid_from) if valid_from else None,
                        "created_at": now(), "updated_at": now()})
    names = {r["id"]: model.display_name(r) for r in
             db.q("SELECT id,name,description FROM entities WHERE id IN (?,?)", a_id, b_id)}
    model.record(uid, "entity", a_id, "bund", None, {"with": b_id, "name": names.get(b_id), "kind": kind_id}, source)
    model.record(uid, "entity", b_id, "bund", None, {"with": a_id, "name": names.get(a_id), "kind": kind_id}, source)
    return bid


@router.post("/bunds")
def new_bund(body: NewBund, ctx: Ctx = Depends(current)):
    with db.tx():
        bid = create_bund(ctx.uid, body.a_id, body.b_id, body.kind_id, body.role_a, body.role_b, body.valid_from)
        for fid, v in body.fields.items():
            d = model.fdef(ctx.uid, fid)
            model.set_single(ctx.uid, "bund", bid, d, v)
    return bund_out(ctx.uid, db.q1("SELECT * FROM bunds WHERE id=?", bid))


@router.get("/bunds")
def list_bunds(entity_id: str | None = None, ctx: Ctx = Depends(current)):
    if entity_id:
        rows = db.q("SELECT * FROM bunds WHERE user_id=? AND (a_id=? OR b_id=?)", ctx.uid, entity_id, entity_id)
    else:
        rows = db.q("SELECT * FROM bunds WHERE user_id=?", ctx.uid)
    vals = {}
    for r in db.q("SELECT owner_id, field_id, value FROM field_values WHERE user_id=? AND owner_type='bund' "
                  "AND deprecated=0 AND is_primary=1", ctx.uid):
        vals.setdefault(r["owner_id"], {})[r["field_id"]] = db.jl(r["value"])
    return [{**b, "values": vals.get(b["id"], {})} for b in rows]


@router.get("/bunds/{bid}")
def get_bund(bid: str, ctx: Ctx = Depends(current)):
    b = db.q1("SELECT * FROM bunds WHERE id=? AND user_id=?", bid, ctx.uid)
    if not b:
        raise HTTPException(404, "Bund nicht gefunden")
    return bund_out(ctx.uid, b)


@router.patch("/bunds/{bid}")
def patch_bund(bid: str, body: dict, ctx: Ctx = Depends(current)):
    b = db.q1("SELECT * FROM bunds WHERE id=? AND user_id=?", bid, ctx.uid)
    if not b:
        raise HTTPException(404, "Bund nicht gefunden")
    upd = {}
    for k in ("kind_id", "role_a", "role_b", "valid_from", "valid_to"):
        if k in body:
            v = body[k]
            if k in ("valid_from", "valid_to") and v:
                v = parse_date(v)
            upd[k] = v
    if "kind_id" in upd and upd["kind_id"]:
        k = db.q1("SELECT * FROM bund_kinds WHERE user_id=? AND id=?", ctx.uid, upd["kind_id"])
        if not k:
            raise Bad("Bund-Art unbekannt")
        upd.setdefault("role_a", k["role_a"])
        upd.setdefault("role_b", k["role_b"])
    for k, v in upd.items():
        model.record(ctx.uid, "bund", bid, k, b[k], v)
    upd["updated_at"] = now()
    db.update("bunds", {"id": bid}, upd)
    for eid in (b["a_id"], b["b_id"]):
        db.ex("UPDATE entities SET updated_at=? WHERE id=?", now(), eid)
    return get_bund(bid, ctx)


@router.put("/bunds/{bid}/fields/{fid}")
def bund_values(bid: str, fid: str, body: dict, ctx: Ctx = Depends(current)):
    if not db.val("SELECT 1 FROM bunds WHERE id=? AND user_id=?", bid, ctx.uid):
        raise HTTPException(404, "Bund nicht gefunden")
    d = model.fdef(ctx.uid, fid)
    if d["scope"] != "bund":
        raise Bad("Kein Bund-Feld")
    model.set_values(ctx.uid, "bund", bid, d, body.get("values", []))
    return get_bund(bid, ctx)


@router.delete("/bunds/{bid}")
def delete_bund(bid: str, ctx: Ctx = Depends(current)):
    b = db.q1("SELECT * FROM bunds WHERE id=? AND user_id=?", bid, ctx.uid)
    if not b:
        raise HTTPException(404, "Bund nicht gefunden")
    me = model.self_id(ctx.uid)
    with db.tx():
        if me in (b["a_id"], b["b_id"]):
            # „Ihr zwei“ wird nicht gelöscht, nur geleert
            db.ex("UPDATE bunds SET kind_id=NULL, role_a=NULL, role_b=NULL WHERE id=?", bid)
        else:
            db.ex("DELETE FROM field_values WHERE owner_type='bund' AND owner_id=?", bid)
            db.ex("DELETE FROM bunds WHERE id=?", bid)
            for x, y in ((b["a_id"], b["b_id"]), (b["b_id"], b["a_id"])):
                model.record(ctx.uid, "entity", x, "bund", {"with": y, "kind": b["kind_id"]}, None)
    return {"ok": True}


@router.put("/entities/{eid}/ihr-zwei")
def ihr_zwei(eid: str, body: dict, ctx: Ctx = Depends(current)):
    """Bund-Art und Rollen von „Ihr zwei“ setzen (legt den Bund bei Bedarf an)."""
    model.get_entity(ctx.uid, eid)
    b = model.self_bund(ctx.uid, eid, create=True)
    if not b:
        raise Bad("Nicht für deinen eigenen Eintrag")
    return patch_bund(b["id"], body, ctx)


# ---------------------------------------------------------------- Bund-Arten

@router.get("/bund-kinds")
def kinds(ctx: Ctx = Depends(current)):
    return db.q("SELECT * FROM bund_kinds WHERE user_id=? ORDER BY position", ctx.uid)


@router.post("/bund-kinds")
def new_kind(body: dict, ctx: Ctx = Depends(current)):
    if not body.get("name"):
        raise Bad("Name fehlt")
    kid = new_id("bk", 6)
    n = db.val("SELECT COUNT(*) FROM bund_kinds WHERE user_id=?", ctx.uid)
    db.insert("bund_kinds", {"user_id": ctx.uid, "id": kid, "name": body["name"],
                             "role_a": body.get("role_a") or body["name"], "role_b": body.get("role_b") or body["name"],
                             "position": n, "icon": body.get("icon")})
    return db.q1("SELECT * FROM bund_kinds WHERE user_id=? AND id=?", ctx.uid, kid)


@router.patch("/bund-kinds/{kid}")
def patch_kind(kid: str, body: dict, ctx: Ctx = Depends(current)):
    db.update("bund_kinds", {"user_id": ctx.uid, "id": kid},
              {k: body[k] for k in ("name", "role_a", "role_b", "position", "icon") if k in body})
    return db.q1("SELECT * FROM bund_kinds WHERE user_id=? AND id=?", ctx.uid, kid)


@router.delete("/bund-kinds/{kid}")
def delete_kind(kid: str, ctx: Ctx = Depends(current)):
    if db.val("SELECT 1 FROM bunds WHERE user_id=? AND kind_id=?", ctx.uid, kid):
        raise Bad("Bund-Art wird noch benutzt")
    db.ex("DELETE FROM bund_kinds WHERE user_id=? AND id=?", ctx.uid, kid)
    return {"ok": True}
