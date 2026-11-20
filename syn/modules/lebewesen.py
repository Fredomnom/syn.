"""Lebewesen: Personen und Haustiere."""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db, model, sync_rules
from ..auth import Ctx, current
from ..model import Bad, display_name, fdef, get_entity, get_values, load_rows
from ..util import fold, today

router = APIRouter(prefix="/api/v1", tags=["Lebewesen"])


def _sort(rows, sort):
    desc = sort.startswith("-")
    key = sort.lstrip("-")

    def k(r):
        if key == "name":
            return (fold(r["display"]),)
        if key in ("created", "created_at"):
            return (r["created_at"] or "",)
        if key == "updated":
            return (r["updated_at"] or "",)
        if key == "level":
            return (r["level"] if r["level"] is not None else 99,)
        if key == "ist":
            return (r["ist"]["ring"] if r["ist"] else 99,)
        x = r["v"].get(key)
        if not x:
            return ("￿",) if not desc else ("",)
        raw = x["raw"]
        return (str(raw).replace("?", "0") if not isinstance(raw, (int, float)) else f"{raw:020.4f}",)

    return sorted(rows, key=k, reverse=desc)


def filter_rows(ctx, rows, kind=None, filt=None, q=None, circle=None, max_level=None, include_self=True):
    cnames = {c["id"]: c["name"] for c in model.circles(ctx.uid).values()}
    out = []
    for r in rows:
        if r["is_self"] and not include_self:
            continue
        if kind in ("person", "pet") and r["kind"] != kind:
            continue
        if filt == "lose" and (r["circles"] or r["is_self"]):
            continue
        if filt == "no_ring" and (r["level"] is not None or r["is_self"]):
            continue
        if filt == "uncertain" and not (r["name_uncertain"] or not r["name"] or any(x["u"] for x in r["v"].values())):
            continue
        if filt == "long_unseen" and not r["long_unseen"]:
            continue
        if circle and circle not in r["circles_all"]:
            continue
        if max_level is not None and (r["level"] is None or r["level"] > max_level):
            continue
        if q and not model.search_match(r, q, cnames):
            continue
        out.append(r)
    return out


@router.get("/entities")
def list_entities(kind: str = "all", filter: str | None = None, q: str | None = None, circle: str | None = None,
                  at: str | None = None, max_level: int | None = None, sort: str = "name",
                  ctx: Ctx = Depends(current)):
    """Liste aller Lebewesen. filter: lose | no_ring | uncertain | long_unseen. at: Stichtag (Zeitregler)."""
    rows = load_rows(ctx, at=at)
    rows = filter_rows(ctx, rows, kind, filter, q, circle, max_level)
    return _sort(rows, sort)


class NewEntity(BaseModel):
    name: str | None = None
    description: str | None = None
    kind: str = "person"
    name_uncertain: bool = False
    fields: dict = {}
    circles: list[str] = []
    new_circle: dict | None = None  # {"name": "...", "kind_id": "hobby"}
    level: int | None = None
    on_phone: bool | None = None
    avatar: str | None = None


def create_full(ctx, body: NewEntity, source="manual") -> str:
    with db.tx():
        eid = model.create_entity(ctx.uid, body.name, body.kind, body.description, body.name_uncertain, source)
        if body.avatar or body.on_phone is not None:
            model.patch_entity(ctx.uid, eid, {k: v for k, v in (("avatar", body.avatar), ("on_phone", body.on_phone))
                                              if v is not None}, source)
        cids = list(body.circles)
        if body.new_circle and body.new_circle.get("name"):
            from .kreise import create_circle
            cids.append(create_circle(ctx.uid, body.new_circle["name"], body.new_circle.get("kind_id"),
                                      body.new_circle.get("parent_id")))
        for cid in cids:
            model.add_member(ctx.uid, cid, eid, source=source)
        for fid, v in (body.fields or {}).items():
            if isinstance(v, dict) and "value" in v and fid not in ("f_via",):
                model.set_entity_field(ctx.uid, eid, fid, v["value"], source, v.get("uncertain"))
            elif isinstance(v, list):
                d = fdef(ctx.uid, fid)
                ot, oid = model.owner_for(ctx.uid, eid, d)
                model.set_values(ctx.uid, ot, oid, d, [x if isinstance(x, dict) else {"value": x} for x in v], source)
            else:
                model.set_entity_field(ctx.uid, eid, fid, v, source)
        if body.level is not None and ctx.settings.get("use_levels"):
            model.set_entity_field(ctx.uid, eid, "f_level", body.level, source)
    return eid


@router.post("/entities")
def create(body: NewEntity, ctx: Ctx = Depends(current)):
    eid = create_full(ctx, body)
    return entity_full(ctx, eid)


# ---------------------------------------------------------------- Schnell erfassen

_CTX_WORDS = r"(?:aus dem|aus der|aus|vom|von der|von|im|in der|bei der|beim|bei|auf der|am)"


def capture_suggest(ctx, text: str):
    """Vorschläge für „Wer ist das?“: Kreis, Kennengelernt, Zuletzt gesehen, mögliche Doppelte."""
    text = (text or "").strip()
    out = {"circle": None, "met_today": True, "seen_today": True, "duplicates": []}
    if not text:
        return out
    ftext = fold(text)
    best = None
    for c in model.circles(ctx.uid).values():
        fn = fold(c["name"])
        if fn and re.search(r"\b" + re.escape(fn) + r"\b", ftext):
            if not best or len(fn) > len(fold(best["name"])):
                best = c
    if best:
        out["circle"] = {"id": best["id"], "name": best["name"], "kind_id": best["kind_id"], "new": False}
    else:
        m = re.search(_CTX_WORDS + r"\s+(.+)$", text, re.I)
        if m:
            name = m.group(1).strip().rstrip(".!")
            name = name[0].upper() + name[1:] if name else name
            if 2 <= len(name) <= 40:
                out["circle"] = {"name": name, "kind_id": "hobby", "new": True}
    from .dubletten import typing_check
    out["duplicates"] = typing_check(ctx, text)
    return out


@router.get("/capture/suggest")
def suggest(text: str, ctx: Ctx = Depends(current)):
    return capture_suggest(ctx, text)


class Quick(BaseModel):
    text: str
    kind: str = "person"
    name_unknown: bool = False
    circle: dict | None = None  # {"id": ...} oder {"name": ..., "kind_id": ..., "new": true}
    met_today: bool = False
    seen_today: bool = False


@router.post("/entities/quick")
def quick(body: Quick, ctx: Ctx = Depends(current)):
    """Ein Feld „Wer ist das?“: Name oder Beschreibung. Ohne Kreis landet die Person unter „Lose“."""
    text = body.text.strip()
    if not text:
        raise Bad("Wer ist das?")
    ne = NewEntity(kind=body.kind)
    if body.name_unknown:
        ne.description = text
        ne.name_uncertain = True
    else:
        ne.name = text
    if body.circle:
        if body.circle.get("id"):
            ne.circles = [body.circle["id"]]
        elif body.circle.get("name"):
            ne.new_circle = {"name": body.circle["name"], "kind_id": body.circle.get("kind_id") or "hobby"}
    fields = {}
    if body.met_today:
        fields["f_met"] = today()
    if body.seen_today:
        fields["f_seen"] = today()
        fields["f_meet"] = 1
    ne.fields = fields
    eid = create_full(ctx, ne)
    return entity_full(ctx, eid)


# ---------------------------------------------------------------- Einzelansicht

def entity_full(ctx, eid) -> dict:
    uid = ctx.uid
    e = get_entity(uid, eid)
    defs = model.field_defs(uid)
    names = {x["id"]: display_name(x) for x in db.q("SELECT id,name,description FROM entities WHERE user_id=?", uid)}
    cs = model.circles(uid)
    names.update({c["id"]: c["name"] for c in cs.values()})
    names.update({"svc:" + k: v for k, v in model.source_names(uid).items()})
    vals = get_values("entity", eid)
    sb = model.self_bund(uid, eid)
    bvals = get_values("bund", sb["id"]) if sb else {}
    me = model.self_id(uid)
    bunds = []
    for b in db.q("SELECT * FROM bunds WHERE user_id=? AND (a_id=? OR b_id=?)", uid, eid, eid):
        other = b["b_id"] if b["a_id"] == eid else b["a_id"]
        if other == me and not e["is_self"]:
            continue
        mine_a = b["a_id"] == eid
        bunds.append({"id": b["id"], "other_id": other, "self_is_a": mine_a, "other_name": names.get(other), "kind_id": b["kind_id"],
                      "role_self": b["role_a"] if mine_a else b["role_b"],
                      "role_other": b["role_b"] if mine_a else b["role_a"],
                      "valid_from": b["valid_from"], "valid_to": b["valid_to"],
                      "fields": get_values("bund", b["id"])})
    mems = []
    for m in model.memberships_of(uid, eid, include_past=True):
        c = cs.get(m["circle_id"])
        mems.append({**m, "circle_name": c["name"] if c else "?", "kind_id": c["kind_id"] if c else None,
                     "parent_id": c["parent_id"] if c else None, "active": model.active(m),
                     "approx_from": not m["valid_from"]})
    row = load_rows(ctx, ids=[eid])[0]
    from .routinen import routines_for
    from .dubletten import pairs_for
    notes = []
    if ctx.settings.get("notes_enabled"):
        notes = db.q("SELECT n.id, n.day, n.text, l.role FROM notes n JOIN note_links l ON l.note_id=n.id "
                     "WHERE l.entity_id=? ORDER BY n.day DESC LIMIT 50", eid)
    return {
        **{k: e[k] for k in ("id", "kind", "name", "description", "avatar", "main_circle_id", "created_at",
                             "updated_at", "valid_from", "valid_to")},
        "is_self": bool(e["is_self"]), "name_uncertain": bool(e["name_uncertain"]), "on_phone": bool(e["on_phone"]),
        "aliases": e["aliases"], "display": display_name(e),
        "fields": {k: v for k, v in vals.items() if k in defs},
        "ihr_zwei": ({"id": sb["id"], "kind_id": sb["kind_id"], "role_a": sb["role_a"], "role_b": sb["role_b"], "a_id": sb["a_id"],
                      "fields": bvals} if sb else None),
        "bunds": bunds, "memberships": mems, "names": names,
        "level": row["level"], "ist": row["ist"], "long_unseen": row["long_unseen"],
        "routines": routines_for(ctx, eid), "duplicates": pairs_for(ctx, eid), "notes": notes,
        "on_phone_effective": sync_rules.synced(ctx, row),
    }


@router.get("/entities/{eid}")
def get_one(eid: str, ctx: Ctx = Depends(current)):
    return entity_full(ctx, eid)


@router.patch("/entities/{eid}")
def patch(eid: str, body: dict, ctx: Ctx = Depends(current)):
    model.patch_entity(ctx.uid, eid, body)
    return entity_full(ctx, eid)


@router.delete("/entities/{eid}")
def delete(eid: str, ctx: Ctx = Depends(current)):
    e = get_entity(ctx.uid, eid)
    if e["is_self"]:
        raise HTTPException(400, "Dein eigener Eintrag ist gesperrt und kann nicht gelöscht werden")
    delete_entity(ctx.uid, eid)
    return {"ok": True}


def delete_entity(uid, eid):
    with db.tx():
        bids = [b["id"] for b in db.q("SELECT id FROM bunds WHERE a_id=? OR b_id=?", eid, eid)]
        for bid in bids:
            db.ex("DELETE FROM field_values WHERE owner_type='bund' AND owner_id=?", bid)
        db.ex("DELETE FROM bunds WHERE a_id=? OR b_id=?", eid, eid)
        db.ex("DELETE FROM field_values WHERE owner_type='entity' AND owner_id=?", eid)
        db.ex("DELETE FROM memberships WHERE entity_id=?", eid)
        db.ex("DELETE FROM contact_signals WHERE entity_id=?", eid)
        db.ex("DELETE FROM note_links WHERE entity_id=?", eid)
        db.ex("DELETE FROM today_items WHERE entity_id=?", eid)
        db.ex("DELETE FROM entities WHERE id=?", eid)
        db.ex("UPDATE suggestions SET status='obsolete' WHERE entity_id=?", eid)
        model.record(uid, "entity", eid, "deleted", None, True)


class Values(BaseModel):
    values: list[dict]


@router.put("/entities/{eid}/fields/{fid}")
def put_values(eid: str, fid: str, body: Values, ctx: Ctx = Depends(current)):
    """Alle Werte eines Feldes setzen (Label, Hauptwert ★, veraltet, unsicher, gültig von/bis)."""
    get_entity(ctx.uid, eid)
    d = fdef(ctx.uid, fid)
    ot, oid = model.owner_for(ctx.uid, eid, d)
    model.set_values(ctx.uid, ot, oid, d, body.values, "manual", ctx.settings.get("country_code", "49"))
    if ot == "bund":
        db.ex("UPDATE entities SET updated_at=? WHERE id=?", model.now(), eid)
    return entity_full(ctx, eid)


class One(BaseModel):
    value: object = None
    uncertain: bool | None = None


@router.patch("/entities/{eid}/fields/{fid}")
def patch_value(eid: str, fid: str, body: One, ctx: Ctx = Depends(current)):
    """Hauptwert eines Feldes setzen. value=null löscht ihn."""
    get_entity(ctx.uid, eid)
    model.set_entity_field(ctx.uid, eid, fid, body.value, "manual", body.uncertain)
    return entity_full(ctx, eid)


class Ring(BaseModel):
    level: int | None


@router.put("/entities/{eid}/ring")
def set_ring(eid: str, body: Ring, ctx: Ctx = Depends(current)):
    if not ctx.settings.get("use_levels"):
        raise Bad("Ringe sind ausgeschaltet")
    model.set_entity_field(ctx.uid, eid, "f_level", body.level)
    return {"ok": True, "level": body.level}


# ---------------------------------------------------------------- Massenbearbeitung

class Bulk(BaseModel):
    ids: list[str]
    op: str
    field: str | None = None
    value: object = None


@router.post("/bulk")
def bulk(body: Bulk, ctx: Ctx = Depends(current)):
    """op: set_field | ring | add_circle | end_circle | main_circle | kind | on_phone | delete"""
    uid = ctx.uid
    me = model.self_id(uid)
    n = 0
    with db.tx():
        for eid in body.ids:
            get_entity(uid, eid)
            if body.op == "set_field":
                model.set_entity_field(uid, eid, body.field, body.value)
            elif body.op == "ring":
                model.set_entity_field(uid, eid, "f_level", body.value)
            elif body.op == "add_circle":
                model.add_member(uid, body.value, eid)
            elif body.op == "end_circle":
                for m in model.memberships_of(uid, eid):
                    if m["circle_id"] == body.value:
                        model.end_member(uid, m["id"])
            elif body.op == "main_circle":
                model.add_member(uid, body.value, eid)
                model.patch_entity(uid, eid, {"main_circle_id": body.value})
            elif body.op in ("kind", "on_phone"):
                model.patch_entity(uid, eid, {body.op: body.value})
            elif body.op == "delete":
                if eid == me:
                    continue
                delete_entity(uid, eid)
            else:
                raise Bad(f"Unbekannte Aktion {body.op}")
            n += 1
    return {"ok": True, "count": n}


class Cells(BaseModel):
    cells: list[dict]  # [{"id": entity_id, "field": fid|"name"|..., "value": ...}]


@router.post("/bulk/cells")
def cells(body: Cells, ctx: Ctx = Depends(current)):
    """Mehrere Zellen auf einmal setzen (Füllen per ⌘D, Einfügen)."""
    with db.tx():
        for c in body.cells:
            f = c["field"]
            if f in ("name", "description", "kind"):
                model.patch_entity(ctx.uid, c["id"], {f: c["value"]})
            elif f == "main_circle_id":
                if c["value"]:
                    model.add_member(ctx.uid, c["value"], c["id"])
                model.patch_entity(ctx.uid, c["id"], {f: c["value"]})
            else:
                model.set_entity_field(ctx.uid, c["id"], f, c["value"])
    return {"ok": True, "count": len(body.cells)}
