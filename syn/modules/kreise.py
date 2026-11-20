"""Kreise: Gruppen ohne Beziehungsbedeutung, eine Ebene tief verschachtelt. Dazu Kreis-Arten."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db, model, seed
from ..auth import Ctx, current
from ..model import Bad, display_name
from ..util import new_id, now, parse_date

router = APIRouter(prefix="/api/v1", tags=["Kreise"])


def create_circle(uid, name, kind_id=None, parent_id=None, description=None) -> str:
    name = (name or "").strip()
    if not name:
        raise Bad("Name fehlt")
    if parent_id:
        p = db.q1("SELECT * FROM circles WHERE id=? AND user_id=?", parent_id, uid)
        if not p:
            raise Bad("Oberkreis unbekannt")
        if p["parent_id"]:
            raise Bad("Kreise sind nur eine Ebene tief verschachtelt")
        kind_id = kind_id or p["kind_id"]
    if kind_id and not db.val("SELECT 1 FROM circle_kinds WHERE user_id=? AND id=?", uid, kind_id):
        raise Bad("Kreis-Art unbekannt")
    cid = new_id("c")
    db.insert("circles", {"id": cid, "user_id": uid, "name": name, "kind_id": kind_id, "parent_id": parent_id,
                          "description": description, "created_at": now(), "updated_at": now()})
    return cid


def circle_out(ctx, c, rows=None):
    rows = rows if rows is not None else model.load_rows(ctx)
    direct = [r for r in rows if c["id"] in r["circles"]]
    allm = [r for r in rows if c["id"] in r["circles_all"]]
    return {**c, "count": len(allm), "direct_count": len(direct),
            "children": [x["id"] for x in db.q("SELECT id FROM circles WHERE parent_id=?", c["id"])],
            "fields": model.get_values("circle", c["id"])}


@router.get("/circles")
def list_circles(ctx: Ctx = Depends(current)):
    rows = model.load_rows(ctx)
    cs = sorted(model.circles(ctx.uid).values(), key=lambda c: c["name"].lower())
    return [circle_out(ctx, c, rows) for c in cs]


class NewCircle(BaseModel):
    name: str
    kind_id: str | None = None
    parent_id: str | None = None
    description: str | None = None
    members: list[str] = []


@router.post("/circles")
def new_circle(body: NewCircle, ctx: Ctx = Depends(current)):
    with db.tx():
        cid = create_circle(ctx.uid, body.name, body.kind_id, body.parent_id, body.description)
        for eid in body.members:
            model.add_member(ctx.uid, cid, eid)
    return get_circle(cid, ctx)


@router.get("/circles/{cid}")
def get_circle(cid: str, ctx: Ctx = Depends(current)):
    c = db.q1("SELECT * FROM circles WHERE id=? AND user_id=?", cid, ctx.uid)
    if not c:
        raise HTTPException(404, "Kreis nicht gefunden")
    out = circle_out(ctx, c)
    ids = [cid] + out["children"]
    names = {e["id"]: display_name(e) for e in db.q("SELECT id,name,description FROM entities WHERE user_id=?",
                                                    ctx.uid)}
    cnames = {x["id"]: x["name"] for x in model.circles(ctx.uid).values()}
    mem = []
    for m in db.q(f"SELECT * FROM memberships WHERE circle_id IN ({','.join('?' * len(ids))}) "
                  "ORDER BY valid_to IS NOT NULL, valid_from", *ids):
        mem.append({**m, "name": names.get(m["entity_id"]), "circle_name": cnames.get(m["circle_id"]),
                    "inherited": m["circle_id"] != cid, "active": model.active(m),
                    "approx_from": not m["valid_from"]})
    out["members"] = mem
    return out


@router.patch("/circles/{cid}")
def patch_circle(cid: str, body: dict, ctx: Ctx = Depends(current)):
    c = db.q1("SELECT * FROM circles WHERE id=? AND user_id=?", cid, ctx.uid)
    if not c:
        raise HTTPException(404, "Kreis nicht gefunden")
    upd = {k: body[k] for k in ("name", "kind_id", "parent_id", "description") if k in body}
    if upd.get("parent_id"):
        if upd["parent_id"] == cid:
            raise Bad("Ein Kreis kann nicht in sich selbst liegen")
        p = db.q1("SELECT * FROM circles WHERE id=? AND user_id=?", upd["parent_id"], ctx.uid)
        if not p or p["parent_id"]:
            raise Bad("Kreise sind nur eine Ebene tief verschachtelt")
        if db.val("SELECT 1 FROM circles WHERE parent_id=?", cid):
            raise Bad("Ein Kreis mit Unterkreisen kann nicht selbst Unterkreis sein")
    upd["updated_at"] = now()
    db.update("circles", {"id": cid}, upd)
    return get_circle(cid, ctx)


@router.delete("/circles/{cid}")
def delete_circle(cid: str, ctx: Ctx = Depends(current)):
    if not db.val("SELECT 1 FROM circles WHERE id=? AND user_id=?", cid, ctx.uid):
        raise HTTPException(404, "Kreis nicht gefunden")
    with db.tx():
        db.ex("UPDATE circles SET parent_id=NULL WHERE parent_id=?", cid)
        db.ex("DELETE FROM memberships WHERE circle_id=?", cid)
        db.ex("UPDATE entities SET main_circle_id=NULL WHERE main_circle_id=?", cid)
        db.ex("DELETE FROM field_values WHERE owner_type='circle' AND owner_id=?", cid)
        db.ex("DELETE FROM circles WHERE id=?", cid)
    return {"ok": True}


class Member(BaseModel):
    entity_id: str
    role: str | None = None
    valid_from: str | None = None
    main: bool = False


@router.post("/circles/{cid}/members")
def add_member(cid: str, body: Member, ctx: Ctx = Depends(current)):
    with db.tx():
        mid = model.add_member(ctx.uid, cid, body.entity_id, body.role, body.valid_from)
        if body.main:
            model.patch_entity(ctx.uid, body.entity_id, {"main_circle_id": cid})
    return {"id": mid}


@router.patch("/memberships/{mid}")
def patch_membership(mid: str, body: dict, ctx: Ctx = Depends(current)):
    m = db.q1("SELECT * FROM memberships WHERE id=? AND user_id=?", mid, ctx.uid)
    if not m:
        raise HTTPException(404, "Mitgliedschaft nicht gefunden")
    upd = {}
    for k in ("role", "valid_from", "valid_to"):
        if k in body:
            upd[k] = parse_date(body[k]) if k != "role" and body[k] else body[k]
    db.update("memberships", {"id": mid}, upd)
    model.record(ctx.uid, "entity", m["entity_id"], "membership:meta",
                 {k: m[k] for k in upd}, upd)
    return db.q1("SELECT * FROM memberships WHERE id=?", mid)


@router.post("/memberships/{mid}/end")
def end_membership(mid: str, body: dict | None = None, ctx: Ctx = Depends(current)):
    """Rausziehen: setzt „bis heute“ (oder ein Datum) und löscht nichts."""
    model.end_member(ctx.uid, mid, (body or {}).get("on"))
    return {"ok": True}


@router.delete("/memberships/{mid}")
def delete_membership(mid: str, ctx: Ctx = Depends(current)):
    """Echte Löschung, z.B. bei einem Versehen. Normal ist /end."""
    m = db.q1("SELECT * FROM memberships WHERE id=? AND user_id=?", mid, ctx.uid)
    if not m:
        raise HTTPException(404, "Mitgliedschaft nicht gefunden")
    db.ex("DELETE FROM memberships WHERE id=?", mid)
    model.record(ctx.uid, "entity", m["entity_id"], "membership", {"circle": m["circle_id"]}, None)
    e = db.q1("SELECT main_circle_id FROM entities WHERE id=?", m["entity_id"])
    if e["main_circle_id"] == m["circle_id"]:
        rest = model.memberships_of(ctx.uid, m["entity_id"])
        db.ex("UPDATE entities SET main_circle_id=? WHERE id=?", rest[0]["circle_id"] if rest else None,
              m["entity_id"])
    return {"ok": True}


@router.put("/circles/{cid}/fields/{fid}")
def circle_values(cid: str, fid: str, body: dict, ctx: Ctx = Depends(current)):
    if not db.val("SELECT 1 FROM circles WHERE id=? AND user_id=?", cid, ctx.uid):
        raise HTTPException(404, "Kreis nicht gefunden")
    d = model.fdef(ctx.uid, fid)
    if d["scope"] != "kreis":
        raise Bad("Kein Kreis-Feld")
    model.set_values(ctx.uid, "circle", cid, d, body.get("values", []))
    return get_circle(cid, ctx)


# ---------------------------------------------------------------- Kreis-Arten

@router.get("/circle-kinds")
def kinds(ctx: Ctx = Depends(current)):
    return {"kinds": list(model.circle_kinds(ctx.uid).values()),
            "lose": {"bg": seed.LOSE_COLORS[0], "fg": seed.LOSE_COLORS[1], "name": "Lose", "abbr": "LO"}}


class Kind(BaseModel):
    name: str
    icon: str | None = None
    abbr: str | None = None
    bg: str | None = None
    fg: str | None = None


@router.post("/circle-kinds")
def new_kind(body: Kind, ctx: Ctx = Depends(current)):
    existing = model.circle_kinds(ctx.uid)
    used = {(k["bg"], k["fg"]) for k in existing.values()}
    pair = next((p for p in seed.EXTRA_PAIRS if p not in used), seed.EXTRA_PAIRS[len(existing) % len(seed.EXTRA_PAIRS)])
    kid = new_id("k", 6)
    db.insert("circle_kinds", {"user_id": ctx.uid, "id": kid, "name": body.name,
                               "abbr": (body.abbr or body.name[:2]).upper(), "bg": body.bg or pair[0],
                               "fg": body.fg or pair[1], "position": len(existing), "icon": body.icon})
    return db.q1("SELECT * FROM circle_kinds WHERE user_id=? AND id=?", ctx.uid, kid)


@router.patch("/circle-kinds/{kid}")
def patch_kind(kid: str, body: dict, ctx: Ctx = Depends(current)):
    db.update("circle_kinds", {"user_id": ctx.uid, "id": kid},
              {k: body[k] for k in ("name", "abbr", "bg", "fg", "position", "icon") if k in body})
    return db.q1("SELECT * FROM circle_kinds WHERE user_id=? AND id=?", ctx.uid, kid)


@router.delete("/circle-kinds/{kid}")
def delete_kind(kid: str, ctx: Ctx = Depends(current)):
    if db.val("SELECT 1 FROM circles WHERE user_id=? AND kind_id=?", ctx.uid, kid):
        raise Bad("Kreis-Art wird noch benutzt")
    db.ex("DELETE FROM circle_kinds WHERE user_id=? AND id=?", ctx.uid, kid)
    return {"ok": True}
