"""Verlauf: jede Änderung mit Zeitpunkt, altem und neuem Wert. Dazu der Stand an einem Stichtag."""
from fastapi import APIRouter, Depends

from .. import db, model
from ..auth import Ctx, current

router = APIRouter(prefix="/api/v1", tags=["Verlauf"])


def _owners(uid, eid):
    owners = [("entity", eid)]
    b = model.self_bund(uid, eid)
    if b:
        owners.append(("bund", b["id"]))
    return owners


@router.get("/entities/{eid}/history")
def entity_history(eid: str, limit: int = 300, ctx: Ctx = Depends(current)):
    model.get_entity(ctx.uid, eid)
    defs = model.field_defs(ctx.uid)
    rows = []
    for ot, oid in _owners(ctx.uid, eid):
        rows += db.q("SELECT * FROM history WHERE owner_type=? AND owner_id=? AND user_id=?", ot, oid, ctx.uid)
    rows.sort(key=lambda r: (r["at"], r["id"]), reverse=True)
    out = []
    for r in rows[:limit]:
        attr = r["attr"]
        base = attr.split(":")[0]
        d = defs.get(base)
        out.append({"id": r["id"], "at": r["at"], "attr": attr,
                    "label": d["name"] if d else ATTR_LABELS.get(base, base), "type": d["type"] if d else None,
                    "old": db.jl(r["old"]), "new": db.jl(r["new"]), "source": r["source"], "owner": r["owner_type"]})
    return out


ATTR_LABELS = {"created": "Erfasst", "name": "Name", "name_uncertain": "Name unsicher", "description": "Beschreibung",
               "aliases": "Aliase", "avatar": "Profilbild", "main_circle_id": "Hauptkreis", "on_phone": "Aufs Handy",
               "kind": "Art", "membership": "Kreis", "bund": "Bund", "merged": "Zusammengeführt",
               "kind_id": "Bund-Art", "valid_from": "Gültig von", "valid_to": "Gültig bis", "deleted": "Gelöscht"}


@router.get("/entities/{eid}/at")
def state_at(eid: str, date: str, ctx: Ctx = Depends(current)):
    """Feldwerte, wie sie am Ende des Stichtags galten (Verlauf rückwärts angewendet)."""
    model.get_entity(ctx.uid, eid)
    cutoff = date + "T23:59:59Z"
    out = {}
    for ot, oid in _owners(ctx.uid, eid):
        cur = {}
        for r in db.q("SELECT * FROM field_values WHERE owner_type=? AND owner_id=?", ot, oid):
            cur[r["id"]] = {"field": r["field_id"], "value": db.jl(r["value"]), "label": r["label"]}
        for h in db.q("SELECT * FROM history WHERE owner_type=? AND owner_id=? AND at>? AND value_id IS NOT NULL "
                      "AND attr NOT LIKE '%:meta' ORDER BY at DESC, id DESC", ot, oid, cutoff):
            old = db.jl(h["old"])
            if old is None:
                cur.pop(h["value_id"], None)
            else:
                cur.setdefault(h["value_id"], {"field": h["attr"], "label": None})["value"] = old
        for v in cur.values():
            out.setdefault(v["field"], []).append({"value": v["value"], "label": v["label"]})
    e = db.q1("SELECT created_at, valid_from FROM entities WHERE id=?", eid)
    existed = (e["valid_from"] or e["created_at"][:10]) <= date
    return {"date": date, "existed": existed, "approx": not e["valid_from"], "fields": out,
            "memberships": [m for m in model.memberships_of(ctx.uid, eid, on=date)]}


@router.get("/history")
def recent(limit: int = 100, ctx: Ctx = Depends(current)):
    rows = db.q("SELECT * FROM history WHERE user_id=? ORDER BY at DESC, id DESC LIMIT ?", ctx.uid, limit)
    for r in rows:
        r["old"], r["new"] = db.jl(r["old"]), db.jl(r["new"])
    return rows


@router.get("/timeline/range")
def time_range(ctx: Ctx = Depends(current)):
    """Spanne für den Zeitregler: frühestes „Gültig von“ bzw. Erfasst-Datum bis heute."""
    a = db.val("SELECT MIN(COALESCE(valid_from, substr(created_at,1,10))) FROM entities WHERE user_id=? "
               "AND (valid_from IS NULL OR valid_from NOT LIKE '%?%')", ctx.uid)
    b = db.val("SELECT MIN(valid_from) FROM memberships WHERE user_id=? AND valid_from NOT LIKE '%?%'", ctx.uid)
    first = min(x for x in (a, b, model.now()[:10]) if x)
    return {"from": first, "to": model.now()[:10]}
