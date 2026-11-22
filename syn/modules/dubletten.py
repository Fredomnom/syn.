"""Doppelte erkennen (Hinweise mit Gründen statt Prozentzahl) und Zusammenführen."""
import json
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db, model
from ..auth import Ctx, current
from ..model import Bad, get_values
from ..util import approx_date, first_name, fold, levenshtein, local_now, nick_match, normalize_phone, now

router = APIRouter(prefix="/api/v1", tags=["Doppelte"])

LEVELS = {"strong": 3, "medium": 2, "all": 1}
STRENGTH = {3: "stark", 2: "mittel", 1: "schwach"}


def _keys(uid, country):
    """Alle Telefonnummern, E-Mails und Dienst-IDs je Eintrag – auch veraltete Werte zählen."""
    phones, emails, svc = {}, {}, {}
    types = {d["id"]: d["type"] for d in db.q("SELECT id, type FROM field_defs WHERE user_id=?", uid)}
    for r in db.q("SELECT owner_id, field_id, value FROM field_values WHERE user_id=? AND owner_type='entity' "
                  "AND field_id IN (SELECT id FROM field_defs WHERE user_id=? AND type IN ('phone','email','profile'))",
                  uid, uid):
        v = db.jl(r["value"])
        t = types.get(r["field_id"])
        if t == "phone":
            n = normalize_phone(v, country)
            if n:
                phones.setdefault(r["owner_id"], set()).add(n)
        elif t == "email":
            emails.setdefault(r["owner_id"], set()).add(str(v).lower())
        elif t == "profile" and isinstance(v, dict) and v.get("service") and (v.get("id") or v.get("handle")):
            svc.setdefault(r["owner_id"], set()).add(f"{v['service']}:{(v.get('id') or v.get('handle')).lower()}")
    return phones, emails, svc


def compute_pairs(ctx, only: str | None = None, typed: dict | None = None, min_level=None):
    """Mögliche Doppelte. Ergebnis: [{a, b, strength, level, reasons}]"""
    uid = ctx.uid
    country = ctx.settings.get("country_code", "49")
    ents = db.q("SELECT id, name, description, name_uncertain, aliases, is_self FROM entities WHERE user_id=?", uid)
    ents = [e for e in ents if not e["is_self"]]
    for e in ents:
        e["aliases"] = db.jl(e["aliases"], []) or []
    if typed:
        ents.append({"id": "__typed__", "name": typed.get("name"), "description": None,
                     "name_uncertain": typed.get("uncertain", False), "aliases": [], "is_self": 0})
    phones, emails, svc = _keys(uid, country)
    marks = {}
    for m in db.q("SELECT * FROM dup_marks WHERE user_id=?", uid):
        if m["mark"] == "later" and m["until"] and m["until"] < now():
            continue
        marks[(m["a_id"], m["b_id"])] = m["mark"]
    circles = {}
    for m in db.q("SELECT entity_id, circle_id, valid_from, valid_to, created_at FROM memberships WHERE user_id=?",
                  uid):
        if model.active(m):
            circles.setdefault(m["entity_id"], set()).add(m["circle_id"])
    bunded = set()
    for b in db.q("SELECT a_id, b_id FROM bunds WHERE user_id=?", uid):
        bunded.add((b["a_id"], b["b_id"]))
        bunded.add((b["b_id"], b["a_id"]))
    # Seltenheit von Vornamen
    fn_count = {}
    for e in ents:
        if e["name"]:
            fn_count[first_name(e["name"])] = fn_count.get(first_name(e["name"]), 0) + 1
    # Kandidatenpaare über Blöcke bilden statt alle Paare zu prüfen
    blocks = {}

    def add(key, eid):
        blocks.setdefault(key, set()).add(eid)

    for e in ents:
        eid = e["id"]
        for p in phones.get(eid, ()):
            add("p:" + p, eid)
        for m in emails.get(eid, ()):
            add("m:" + m, eid)
        for s in svc.get(eid, ()):
            add("s:" + s, eid)
        names = [n for n in [e["name"], *e["aliases"]] if n]
        for n in names:
            f = first_name(n)
            if f:
                add("f:" + f, eid)
                for nick in model_nicks(f):
                    add("f:" + nick, eid)
            ln = fold(n).split()
            if len(ln) > 1:
                add("l:" + ln[-1], eid)
    cand = set()
    for ids in blocks.values():
        if len(ids) > 60:
            continue
        ids = sorted(ids)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                cand.add((ids[i], ids[j]))
    by_id = {e["id"]: e for e in ents}
    sens = LEVELS.get(min_level or ctx.settings.get("dup_sensitivity", "medium"), 2)
    out = []
    for a, b in cand:
        if only and only not in (a, b):
            continue
        ea, eb = by_id[a], by_id[b]
        reasons, level = [], 0
        # starke Hinweise
        if svc.get(a, set()) & svc.get(b, set()):
            reasons.append("gleiche Dienst-ID")
            level = 3
        if phones.get(a, set()) & phones.get(b, set()):
            reasons.append("gleiche Telefonnummer")
            level = 3
        if emails.get(a, set()) & emails.get(b, set()):
            reasons.append("gleiche E-Mail")
            level = 3
        na, nb = ea["name"] or "", eb["name"] or ""
        fa, fb = fold(na), fold(nb)
        # mittlere Hinweise
        if fa and fb and len(fa.split()) > 1 and len(fb.split()) > 1:
            if fa == fb:
                reasons.append("gleicher voller Name")
                level = max(level, 2)
            elif levenshtein(fa, fb) <= max(1, min(len(fa), len(fb)) // 8):
                reasons.append("gleicher voller Name mit kleinem Schreibunterschied")
                level = max(level, 2)
        als_a = [fold(x) for x in ea["aliases"]] + ([fold(ea["description"])] if ea["description"] else [])
        als_b = [fold(x) for x in eb["aliases"]] + ([fold(eb["description"])] if eb["description"] else [])
        if (fa and fa in als_b) or (fb and fb in als_a):
            reasons.append("Name passt zu einem Alias")
            level = max(level, 2)
        if fa and fb:
            ga, gb = fa.split()[0], fb.split()[0]
            rest_a, rest_b = fa.split()[1:], fb.split()[1:]
            if nick_match(ga, gb) and (rest_a == rest_b or not rest_a or not rest_b):
                reasons.append(f"Spitzname passt zum Namen ({ga.title()}, {gb.title()})")
                level = max(level, 2)
            # schwache Hinweise: nur Vorname gleich, plus Zusatz
            if ga == gb and level < 2 and (not rest_a or not rest_b):
                extra = []
                if ea["name_uncertain"] or eb["name_uncertain"]:
                    extra.append("ein Name ist unsicher")
                if fn_count.get(ga, 0) <= 2:
                    extra.append("Vorname ist in deinen Kontakten selten")
                if extra:
                    reasons.append("gleicher Vorname, " + " und ".join(extra))
                    level = max(level, 1)
        if not level:
            continue
        # Gegenhinweise
        counter = []
        pa, pb = phones.get(a, set()), phones.get(b, set())
        if pa and pb and not (pa & pb) and level < 3:
            counter.append("verschiedene Nummern")
        if circles.get(a, set()) & circles.get(b, set()) and level < 3:
            counter.append("beide gleichzeitig im selben Kreis")
        if (a, b) in bunded:
            counter.append("bestehender Bund zwischen beiden")
        key = tuple(sorted((a, b)))
        if marks.get(key) == "distinct":
            counter.append("als verschiedene Personen markiert")
        if marks.get(key) == "later" and not typed:
            continue
        if counter:
            continue
        if level < sens:
            continue
        out.append({"a": a, "b": b, "level": level, "strength": STRENGTH[level], "reasons": reasons})
    out.sort(key=lambda p: -p["level"])
    return out


def model_nicks(f):
    from ..util import NICKNAMES
    return NICKNAMES.get(f, ())


def pairs_for(ctx, eid):
    out = []
    names = {e["id"]: model.display_name(e) for e in db.q("SELECT id,name,description FROM entities WHERE user_id=?",
                                                          ctx.uid)}
    for p in compute_pairs(ctx, only=eid):
        other = p["b"] if p["a"] == eid else p["a"]
        out.append({**p, "other_id": other, "other_name": names.get(other)})
    return out


def typing_check(ctx, text):
    """„Schon da? Kai Reuter · Klasse“ – Prüfung während des Tippens."""
    text = (text or "").strip()
    if len(text) < 2:
        return []
    ft = fold(text)
    rows = model.load_rows(ctx)
    cnames = {c["id"]: c["name"] for c in model.circles(ctx.uid).values()}
    hits = []
    for r in rows:
        if r["is_self"]:
            continue
        names = [r["name"] or "", *r["aliases"], r["description"] or ""]
        score = 0
        for n in names:
            fn = fold(n)
            if not fn:
                continue
            if fn == ft:
                score = max(score, 3)
            elif fn.startswith(ft) or ft.startswith(fn.split()[0]) and len(ft.split()) == 1:
                score = max(score, 2)
            elif ft.split()[0] == fn.split()[0] or nick_match(ft.split()[0], fn.split()[0]):
                score = max(score, 1)
        if score:
            hits.append((score, {"id": r["id"], "display": r["display"], "name_uncertain": r["name_uncertain"],
                                 "circle": cnames.get(r["main_circle_id"]), "main_circle_id": r["main_circle_id"]}))
    hits.sort(key=lambda h: -h[0])
    return [h[1] for h in hits[:5]]


@router.get("/duplicates")
def list_pairs(entity_id: str | None = None, sensitivity: str | None = None, ctx: Ctx = Depends(current)):
    pairs = compute_pairs(ctx, only=entity_id, min_level=sensitivity)
    ids = {p["a"] for p in pairs} | {p["b"] for p in pairs}
    rows = {r["id"]: r for r in model.load_rows(ctx, ids=ids)} if ids else {}
    return [{**p, "a_row": rows.get(p["a"]), "b_row": rows.get(p["b"])} for p in pairs]


@router.get("/duplicates/check")
def check_typing(text: str, ctx: Ctx = Depends(current)):
    return typing_check(ctx, text)


class Pair(BaseModel):
    a: str
    b: str


@router.post("/duplicates/distinct")
def mark_distinct(body: Pair, ctx: Ctx = Depends(current)):
    a, b = sorted((body.a, body.b))
    db.ex("INSERT OR REPLACE INTO dup_marks(user_id,a_id,b_id,mark,until) VALUES(?,?,?,?,NULL)", ctx.uid, a, b,
          "distinct")
    return {"ok": True}


@router.post("/duplicates/later")
def mark_later(body: Pair, ctx: Ctx = Depends(current)):
    a, b = sorted((body.a, body.b))
    until = (local_now() + timedelta(days=14)).astimezone().isoformat()
    db.ex("INSERT OR REPLACE INTO dup_marks(user_id,a_id,b_id,mark,until) VALUES(?,?,?,?,?)", ctx.uid, a, b, "later",
          until)
    return {"ok": True}


# ---------------------------------------------------------------- Zusammenführen

ENTITY_ATTRS = ("name", "kind", "avatar", "main_circle_id")  # Beschreibung wird Alias, „unsicher“ folgt dem Namen


def _adopt_bund(src, dst, other, keep):
    """Übernimmt Art, Rollen und Felder aus Bund src in Bund dst, wo dst noch nichts hat.
    Rollen werden passend gedreht: in src steht „other“, in dst „keep“ an der jeweiligen Seite."""
    if not dst["kind_id"] and src["kind_id"]:
        side = lambda b, who: "a" if b["a_id"] == who else "b"  # noqa: E731
        s_me, d_me = side(src, other), side(dst, keep)           # Seite der zusammengeführten Person
        ra, rb = src["role_a"], src["role_b"]
        if s_me != d_me:
            ra, rb = rb, ra
        db.ex("UPDATE bunds SET kind_id=?, role_a=?, role_b=? WHERE id=?", src["kind_id"], ra, rb, dst["id"])
    have = {r["field_id"] for r in db.q("SELECT DISTINCT field_id FROM field_values WHERE owner_type='bund' AND owner_id=?", dst["id"])}
    for r in db.q("SELECT id, field_id FROM field_values WHERE owner_type='bund' AND owner_id=?", src["id"]):
        if r["field_id"] not in have:
            db.ex("UPDATE field_values SET owner_id=? WHERE id=?", dst["id"], r["id"])


def _same_key(v):
    """Vergleichsschlüssel für „derselbe Wert“: Profile über Dienst + ID/Name, sonst sortiertes JSON."""
    if isinstance(v, dict) and v.get("service"):
        who = v.get("id") or v.get("handle") or v.get("url") or ""
        return ("svc", str(v["service"]).lower(), str(who).strip().lower())
    if isinstance(v, str):
        return ("s", v.strip().lower())
    return ("j", json.dumps(v, sort_keys=True, ensure_ascii=False))


def plan_merge(ctx, a_id, b_id):
    """Pro Feld: Werte beider Einträge und was syn selbst entscheidet."""
    uid = ctx.uid
    ea, eb = model.get_entity(uid, a_id), model.get_entity(uid, b_id)
    if ea["is_self"] or eb["is_self"]:
        raise Bad("Dein eigener Eintrag kann nicht zusammengeführt werden")
    defs = model.field_defs(uid)
    va, vb = get_values("entity", a_id), get_values("entity", b_id)
    sa, sb = model.self_bund(uid, a_id), model.self_bund(uid, b_id)
    bva = get_values("bund", sa["id"]) if sa else {}
    bvb = get_values("bund", sb["id"]) if sb else {}
    items = []

    def decide(fid, d, xa, xb):
        pa, pb = model.primary(xa), model.primary(xb)
        auto, why = None, ""
        if xa and not xb:
            auto, why = "a", "nur in einem Eintrag"
        elif xb and not xa:
            auto, why = "b", "nur in einem Eintrag"
        elif d["multi"]:
            # Mehrfachfelder (Profile, Nummern, E-Mails …): immer alle Werte behalten, doppelte nur einmal
            auto, why = "both", "Mehrfachfeld: alle Werte bleiben"
        elif pa and pb and pa["value"] == pb["value"]:
            auto, why = "a", "gleich"
        elif d["type"] == "date" and pa and pb:
            da, db_ = approx_date(pa["value"]), approx_date(pb["value"])
            if fid in ("f_seen",) or d["options"].get("newer_wins", fid != "f_bday"):
                if da and db_ and da != db_:
                    auto, why = ("a" if da > db_ else "b"), "neueres Datum gewinnt"
        elif d["type"] == "number" and fid == "f_meet" and pa and pb:
            auto, why = "sum", "Zähler werden addiert"
        return {"field": fid, "name": d["name"], "type": d["type"], "a": xa, "b": xb, "auto": auto, "why": why,
                "owner": "bund" if d["scope"] == "bund" else "entity", "multi": bool(d["multi"])}

    for fid, d in defs.items():
        if d["scope"] == "kreis":
            continue
        xa = (bva if d["scope"] == "bund" else va).get(fid, [])
        xb = (bvb if d["scope"] == "bund" else vb).get(fid, [])
        if xa or xb:
            items.append(decide(fid, d, xa, xb))
    attrs = []
    for k in ENTITY_ATTRS:
        A, B = ea[k], eb[k]
        if A == B or (not A and not B):
            continue
        auto = "a" if A and not B else "b" if B and not A else None
        if k == "name" and ea["name_uncertain"] != eb["name_uncertain"] and A and B:
            auto = "a" if not ea["name_uncertain"] else "b"
        attrs.append({"attr": k, "a": A, "b": B, "auto": auto})
    circ_a = [m["circle_id"] for m in model.memberships_of(uid, a_id)]
    circ_b = [m["circle_id"] for m in model.memberships_of(uid, b_id)]
    return {"a": {"id": a_id, "display": model.display_name(ea)}, "b": {"id": b_id, "display": model.display_name(eb)},
            "fields": items, "attrs": attrs, "circles": sorted(set(circ_a) | set(circ_b)),
            "note": "Kreise bleiben beide, der Verlauf beider Einträge bleibt erhalten."}


@router.get("/merge/preview")
def merge_preview(a: str, b: str, ctx: Ctx = Depends(current)):
    return plan_merge(ctx, a, b)


class MergeIn(BaseModel):
    keep: str
    other: str
    choices: dict = {}  # field_id|attr -> "a" | "b" | "both" | "sum"; a = keep, b = other


@router.post("/merge")
def merge(body: MergeIn, ctx: Ctx = Depends(current)):
    uid = ctx.uid
    plan = plan_merge(ctx, body.keep, body.other)
    keep, other = body.keep, body.other
    ek, eo = model.get_entity(uid, keep), model.get_entity(uid, other)
    defs = model.field_defs(uid)
    with db.tx():
        # 1. Eigenschaften
        upd = {}
        name_from = "a"
        for a in plan["attrs"]:
            ch = body.choices.get(a["attr"], a["auto"] or "a")
            if a["attr"] == "name":
                name_from = ch
            if ch == "b":
                upd[a["attr"]] = a["b"]
        src = eo if name_from == "b" else ek
        if not (upd.get("name", ek["name"])):
            upd["name_uncertain"] = 1
        else:
            upd["name_uncertain"] = src["name_uncertain"] if src["name"] else ek["name_uncertain"]
        al = list(dict.fromkeys(ek["aliases"] + eo["aliases"] +
                                [x for x in (eo["name"], eo["description"], ek["description"]) if x]))
        new_name = upd.get("name", ek["name"])
        al = [x for x in al if x != new_name]
        upd["aliases"] = al
        if new_name:
            upd["description"] = None
        # 2. Felder
        sk = model.self_bund(uid, keep, create=True)
        for f in plan["fields"]:
            d = defs[f["field"]]
            ch = body.choices.get(f["field"], f["auto"] or "a")
            if d["multi"] and f["a"] and f["b"]:
                ch = "both"  # Mehrfachfelder verlieren beim Zusammenführen nie Werte
            ot, oid = ("bund", sk["id"]) if f["owner"] == "bund" else ("entity", keep)
            if ch == "a":
                vals = f["a"]
            elif ch == "b":
                vals = [{k: v for k, v in x.items() if k != "id"} for x in f["b"]]
            elif ch == "sum":
                pa, pb = model.primary(f["a"]), model.primary(f["b"])
                vals = [{**(pa or {}), "value": (pa["value"] if pa else 0) + (pb["value"] if pb else 0)}]
            else:  # both: alle Werte, derselbe Wert nur einmal
                seen = {_same_key(x["value"]) for x in f["a"]}
                vals = list(f["a"])
                for x in f["b"]:
                    k = _same_key(x["value"])
                    if k not in seen:
                        seen.add(k)
                        vals.append({**{kk: v for kk, v in x.items() if kk != "id"}, "primary": False})
            if not d["multi"]:
                vals = vals[:1]
            model.set_values(uid, ot, oid, d, vals, "Zusammenführen")
        # 3. Kreise bleiben beide
        for m in model.memberships_of(uid, other, include_past=True):
            if not db.val("SELECT 1 FROM memberships WHERE entity_id=? AND circle_id=? AND "
                          "COALESCE(valid_to,'')=COALESCE(?, '')", keep, m["circle_id"], m["valid_to"]):
                db.ex("UPDATE memberships SET entity_id=? WHERE id=?", keep, m["id"])
        # 4. Bünde übernehmen. „Ihr zwei“ (dein Bund mit dem zweiten Eintrag) VOR dem Aufräumen merken –
        #    sonst ist er weg, bevor Art und Rollen übernommen werden.
        me = model.self_id(uid)
        so = model.self_bund(uid, other)
        if so:
            _adopt_bund(so, sk, other, keep)
        for b in db.q("SELECT * FROM bunds WHERE user_id=? AND (a_id=? OR b_id=?)", uid, other, other):
            o = b["b_id"] if b["a_id"] == other else b["a_id"]
            if o == me or o == keep:
                db.ex("DELETE FROM field_values WHERE owner_type='bund' AND owner_id=?", b["id"])
                db.ex("DELETE FROM bunds WHERE id=?", b["id"])
                continue
            dup = db.q1("SELECT * FROM bunds WHERE (a_id=? AND b_id=?) OR (a_id=? AND b_id=?)", keep, o, o, keep)
            if dup:
                # beide hatten einen Bund zur selben Person: zusammenlegen statt den zweiten wegzuwerfen
                _adopt_bund(b, dup, other, keep)
                db.ex("DELETE FROM field_values WHERE owner_type='bund' AND owner_id=?", b["id"])
                db.ex("DELETE FROM bunds WHERE id=?", b["id"])
                continue
            col = "a_id" if b["a_id"] == other else "b_id"
            db.ex(f"UPDATE bunds SET {col}=? WHERE id=?", keep, b["id"])
        # 5. Verlauf beider Einträge bleibt erhalten
        db.ex("UPDATE history SET owner_id=? WHERE owner_type='entity' AND owner_id=?", keep, other)
        if so:
            db.ex("UPDATE history SET owner_id=? WHERE owner_type='bund' AND owner_id=?", sk["id"], so["id"])
        # 6. Verweise auf den alten Eintrag umbiegen
        for v in db.q("SELECT id, value FROM field_values WHERE user_id=? AND (value=? OR value LIKE ?)", uid,
                      db.jd(other), f'%"{other}"%'):
            val = db.jl(v["value"])
            if val == other:
                val = keep
            elif isinstance(val, dict) and val.get("id") == other:
                val["id"] = keep
            db.ex("UPDATE field_values SET value=? WHERE id=?", db.jd(val), v["id"])
        db.ex("UPDATE OR IGNORE contact_signals SET entity_id=? WHERE entity_id=?", keep, other)
        db.ex("DELETE FROM contact_signals WHERE entity_id=?", other)
        db.ex("UPDATE OR IGNORE note_links SET entity_id=? WHERE entity_id=?", keep, other)
        db.ex("DELETE FROM note_links WHERE entity_id=?", other)
        db.ex("UPDATE today_items SET entity_id=? WHERE entity_id=?", keep, other)
        db.ex("UPDATE suggestions SET entity_id=? WHERE entity_id=?", keep, other)
        db.ex("DELETE FROM google_map WHERE entity_id=?", other)
        if eo["on_phone"]:
            upd["on_phone"] = 1
        if eo["created_at"] and eo["created_at"] < ek["created_at"]:
            db.ex("UPDATE entities SET created_at=? WHERE id=?", eo["created_at"], keep)
        model.patch_entity(uid, keep, upd, "Zusammenführen")
        db.ex("DELETE FROM field_values WHERE owner_type='entity' AND owner_id=?", other)
        db.ex("DELETE FROM entities WHERE id=?", other)
        model.record(uid, "entity", keep, "merged", {"id": other, "name": model.display_name(eo)}, {"id": keep},
                     "Zusammenführen")
    from .lebewesen import entity_full
    return entity_full(ctx, keep)
