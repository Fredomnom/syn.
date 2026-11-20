"""Vorschläge: neue Kreise aus den Daten, Werte aus Importen und Google. Nie verpflichtend."""
import hashlib

from fastapi import APIRouter, Depends, HTTPException

from .. import db, model
from ..auth import Ctx, current
from ..util import new_id, now

router = APIRouter(prefix="/api/v1", tags=["Vorschläge"])


def add_suggestion(uid, kind, entity_id, payload, source):
    """Legt einen Vorschlag an – gleiche offene Vorschläge werden nicht doppelt angelegt."""
    pj = db.jd(payload)
    if db.val("SELECT 1 FROM suggestions WHERE user_id=? AND kind=? AND entity_id IS ? AND payload=? "
              "AND status IN ('open','rejected')", uid, kind, entity_id, pj):
        return None
    sid = new_id("s")
    db.insert("suggestions", {"id": sid, "user_id": uid, "kind": kind, "entity_id": entity_id, "payload": pj,
                              "source": source, "created_at": now(), "status": "open"})
    return sid


def _cliques(adj):
    out = []

    def bk(r, p, x):
        if not p and not x:
            if len(r) >= 3:
                out.append(r)
            return
        u = max(p | x, key=lambda n: len(adj[n] & p))
        for v in list(p - adj[u]):
            bk(r | {v}, p & adj[v], x & adj[v])
            p = p - {v}
            x = x | {v}

    bk(set(), set(adj), set())
    return out


def circle_suggestions(ctx):
    uid = ctx.uid
    rows = {r["id"]: r for r in model.load_rows(ctx) if not r["is_self"]}
    me = model.self_id(uid)
    cs = model.circles(uid)
    dismissed = {db.jl(s["payload"], {}).get("key") for s in
                 db.q("SELECT payload FROM suggestions WHERE user_id=? AND kind='circle' AND status!='open'", uid)}
    adj = {}
    for b in db.q("SELECT a_id, b_id FROM bunds WHERE user_id=?", uid):
        if me in (b["a_id"], b["b_id"]) or b["a_id"] not in rows or b["b_id"] not in rows:
            continue
        adj.setdefault(b["a_id"], set()).add(b["b_id"])
        adj.setdefault(b["b_id"], set()).add(b["a_id"])
    out = []
    for cl in _cliques(adj):
        shared = set.intersection(*(set(rows[i]["circles_all"]) for i in cl))
        if shared:
            continue
        ids = sorted(cl, key=lambda i: rows[i]["display"])
        key = "clique:" + hashlib.sha1(",".join(sorted(ids)).encode()).hexdigest()[:12]
        if key in dismissed:
            continue
        names = [rows[i]["display"] for i in ids]
        out.append({"key": key, "name": " & ".join(n.split()[0] for n in names[:3]) + (" …" if len(names) > 3 else ""),
                    "kind_id": "freundschaft", "members": ids, "member_names": names,
                    "reason": "alle untereinander verbunden"})
    # gleicher „Kennengelernt über“-Wert
    via = {}
    for r in rows.values():
        x = r["v"].get("f_via")
        if x and isinstance(x["raw"], dict):
            via.setdefault((x["raw"]["type"], x["raw"]["id"]), []).append(r["id"])
    for (typ, rid), ids in via.items():
        if typ == "circle":
            missing = [i for i in ids if rid not in rows[i]["circles_all"]]
            if len(missing) < 2 or rid not in cs:
                continue
            key = f"via:{rid}:" + hashlib.sha1(",".join(sorted(missing)).encode()).hexdigest()[:8]
            if key in dismissed:
                continue
            out.append({"key": key, "name": cs[rid]["name"], "circle_id": rid, "kind_id": cs[rid]["kind_id"],
                        "members": missing, "member_names": [rows[i]["display"] for i in missing],
                        "reason": f"„Kennengelernt über“ zeigt auf {cs[rid]['name']}, aber sie sind keine Mitglieder"})
        elif len(ids) >= 3:
            shared = set.intersection(*(set(rows[i]["circles_all"]) for i in ids))
            if shared:
                continue
            key = f"via:{rid}:" + hashlib.sha1(",".join(sorted(ids)).encode()).hexdigest()[:8]
            if key in dismissed:
                continue
            who = rows[rid]["display"] if rid in rows else ("dir" if rid == me else "?")
            out.append({"key": key, "name": f"Über {who}", "kind_id": "freundschaft", "members": ids,
                        "member_names": [rows[i]["display"] for i in ids],
                        "reason": f"gleicher „Kennengelernt über“-Wert ({who})"})
    return out


@router.get("/suggestions/circles")
def get_circle_suggestions(ctx: Ctx = Depends(current)):
    return circle_suggestions(ctx)


@router.post("/suggestions/circles/accept")
def accept_circle(body: dict, ctx: Ctx = Depends(current)):
    from .kreise import create_circle
    with db.tx():
        cid = body.get("circle_id")
        if not cid:
            cid = create_circle(ctx.uid, body.get("name") or "Neuer Kreis", body.get("kind_id"))
        for eid in body.get("members", []):
            model.add_member(ctx.uid, cid, eid)
        add_suggestion(ctx.uid, "circle", None, {"key": body.get("key")}, "Vorschlag")
        db.ex("UPDATE suggestions SET status='accepted' WHERE user_id=? AND kind='circle' AND payload=?", ctx.uid,
              db.jd({"key": body.get("key")}))
    return {"id": cid}


@router.post("/suggestions/circles/dismiss")
def dismiss_circle(body: dict, ctx: Ctx = Depends(current)):
    add_suggestion(ctx.uid, "circle", None, {"key": body.get("key")}, "Vorschlag")
    db.ex("UPDATE suggestions SET status='rejected' WHERE user_id=? AND kind='circle' AND payload=?", ctx.uid,
          db.jd({"key": body.get("key")}))
    return {"ok": True}


@router.get("/suggestions")
def list_suggestions(entity_id: str | None = None, ctx: Ctx = Depends(current)):
    sql = "SELECT * FROM suggestions WHERE user_id=? AND status='open' AND kind!='circle'"
    args = [ctx.uid]
    if entity_id:
        sql += " AND entity_id=?"
        args.append(entity_id)
    rows = db.q(sql + " ORDER BY created_at DESC", *args)
    defs = model.field_defs(ctx.uid)
    names = {e["id"]: model.display_name(e) for e in db.q("SELECT id,name,description FROM entities WHERE user_id=?",
                                                          ctx.uid)}
    for r in rows:
        r["payload"] = db.jl(r["payload"], {})
        r["entity_name"] = names.get(r["entity_id"])
        f = r["payload"].get("field")
        if f in defs:
            r["field_name"] = defs[f]["name"]
    return rows


@router.post("/suggestions/{sid}/accept")
def accept(sid: str, ctx: Ctx = Depends(current)):
    s = db.q1("SELECT * FROM suggestions WHERE id=? AND user_id=? AND status='open'", sid, ctx.uid)
    if not s:
        raise HTTPException(404, "Vorschlag nicht gefunden")
    p = db.jl(s["payload"], {})
    with db.tx():
        if s["kind"] == "field":
            d = model.fdef(ctx.uid, p["field"])
            ot, oid = model.owner_for(ctx.uid, s["entity_id"], d)
            if p.get("replace_value") is not None and d["multi"]:
                vals = model.get_values(ot, oid).get(d["id"], [])
                for v in vals:
                    if v["value"] == p["replace_value"]:
                        v["value"] = p["value"]
                        v["source"] = "manual"
                model.set_values(ctx.uid, ot, oid, d, vals)
            elif d["multi"] and p.get("value") is not None:
                model.add_value(ctx.uid, ot, oid, d, p["value"], "manual", p.get("label"))
            else:
                model.set_single(ctx.uid, ot, oid, d, p.get("value"), "manual")
        elif s["kind"] == "name":
            model.patch_entity(ctx.uid, s["entity_id"], {"name": p["value"]})
        db.ex("UPDATE suggestions SET status='accepted' WHERE id=?", sid)
    return {"ok": True}


@router.post("/suggestions/{sid}/reject")
def reject(sid: str, ctx: Ctx = Depends(current)):
    db.ex("UPDATE suggestions SET status='rejected' WHERE id=? AND user_id=?", sid, ctx.uid)
    return {"ok": True}
