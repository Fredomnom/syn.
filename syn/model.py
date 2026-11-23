"""Kern des Datenmodells: Felder, Werte mit Label/Hauptwert/Quelle, Verlauf, Lebewesen, Kreise, Bünde."""
import re
from datetime import date

from fastapi import HTTPException

from . import db
from .util import (approx_date, date_parts, days_since, fold, new_id, normalize_email, normalize_phone, now,
                   parse_date, today)

FIELD_TYPES = ["text", "note", "number", "date", "choice", "checkbox", "person", "ref", "phone", "email",
               "address", "profile", "image"]
# Quellen für „Kennengelernt über“, die keine Profil-Dienste sind
EXTRA_SOURCES = {"imap": "E-Mail", "kalender": "Kalender", "vcard": "Handy-Kontakte", "android": "Anrufe & SMS",
                 "carddav": "Adressbuch (CardDAV)", "google": "Google Kontakte",
                 "card": "Visitenkarte"}


def source_names(uid) -> dict:
    """Alle Quellen (Dienste aus der Profil-Liste und Import-Quellen) mit Anzeigenamen."""
    from .auth import user_settings
    out = dict(EXTRA_SOURCES)
    for s in user_settings(uid).get("services", []):
        out[s["id"]] = s["name"]
    return out


# Werte, die ein Telefonbuch versteht
PHONEBOOK_FIELDS = {"f_phone", "f_email", "f_bday"}


class Bad(HTTPException):
    def __init__(self, msg):
        super().__init__(400, msg)


# ---------------------------------------------------------------- Felddefinitionen

def field_defs(uid: str) -> dict:
    rows = db.q("SELECT * FROM field_defs WHERE user_id=? ORDER BY position, name", uid)
    out = {}
    for r in rows:
        r["options"] = db.jl(r["options"], {}) or {}
        r["multi"] = bool(r["multi"])
        r["is_base"] = bool(r["is_base"])
        out[r["id"]] = r
    return out


def fdef(uid: str, fid: str) -> dict:
    d = field_defs(uid).get(fid)
    if not d:
        raise HTTPException(404, f"Feld {fid} unbekannt")
    return d


def scope_fits(d: dict, kind: str) -> bool:
    s = d["scope"]
    return s == "both" or s == kind or (s == "bund")


def normalize_value(uid: str, d: dict, v, country="49"):
    t = d["type"]
    if v is None or v == "" or v == []:
        return None
    try:
        if t == "text":
            return re.sub(r"\s*\n\s*", " ", str(v)).strip() or None
        if t in ("note", "address"):
            return str(v).strip() or None
        if t == "number":
            n = float(str(v).replace(",", "."))
            o = d["options"]
            if "min" in o and n < o["min"] or "max" in o and n > o["max"]:
                raise Bad(f"{d['name']}: Wert außerhalb {o.get('min')}–{o.get('max')}")
            return int(n) if n == int(n) else n
        if t == "date":
            p = parse_date(v)
            if not p:
                raise Bad(f"{d['name']}: Datum nicht lesbar: {v}")
            return p
        if t == "choice":
            vals = v if isinstance(v, list) else [v]
            vals = [str(x).strip() for x in vals if str(x).strip()]
            o = d["options"]
            choices = o.setdefault("choices", [])
            added = [x for x in vals if x not in choices]
            if added:
                choices.extend(added)
                db.ex("UPDATE field_defs SET options=? WHERE user_id=? AND id=?", db.jd(o), uid, d["id"])
            if o.get("multiple"):
                return vals or None
            return vals[0] if vals else None
        if t == "checkbox":
            if isinstance(v, str):
                return v.lower() in ("1", "true", "ja", "yes", "x", "on")
            return bool(v)
        if t == "person":
            pid = v["id"] if isinstance(v, dict) else str(v)
            if not db.val("SELECT 1 FROM entities WHERE id=? AND user_id=?", pid, uid):
                raise Bad(f"{d['name']}: Person {pid} unbekannt")
            return pid
        if t == "ref":
            if isinstance(v, str):
                v = {"type": "circle" if v.startswith("c_") else "entity" if v.startswith("p_") else "service", "id": v}
            typ, rid = v.get("type"), v.get("id")
            if typ == "service":
                if rid not in source_names(uid):
                    raise Bad(f"{d['name']}: Quelle {rid} unbekannt")
                return {"type": "service", "id": rid}
            if typ == "place":  # Kennlernort – ein Ort ist ein Wert, keine eigene Seite
                name = str(rid or v.get("name") or "").strip()
                if not name:
                    raise Bad(f"{d['name']}: Ort fehlt")
                return {"type": "place", "id": name[:120]}
            tbl = {"entity": "entities", "circle": "circles"}.get(typ)
            if not tbl or not db.val(f"SELECT 1 FROM {tbl} WHERE id=? AND user_id=?", rid, uid):
                raise Bad(f"{d['name']}: Verweis ungültig")
            return {"type": typ, "id": rid}
        if t == "phone":
            s = str(v).strip()
            if not re.search(r"\d", s):
                raise Bad(f"{d['name']}: keine Nummer")
            return s
        if t == "email":
            s = normalize_email(v)
            if "@" not in s:
                raise Bad(f"{d['name']}: keine E-Mail-Adresse")
            return s
        if t == "profile":
            if isinstance(v, str):
                v = {"service": "", "handle": v}
            out = {k: str(v[k]).strip() for k in ("service", "handle", "id", "url") if v.get(k)}
            if not out.get("handle") and not out.get("id") and not out.get("url"):
                return None
            from .importe import resolve_profile_id
            return resolve_profile_id(uid, out)
        if t == "image":
            return str(v)
    except Bad:
        raise
    except (TypeError, ValueError):
        raise Bad(f"{d['name']}: ungültiger Wert")
    return v


def display(d: dict, v, names: dict | None = None) -> str:
    if v is None:
        return ""
    t = d["type"]
    if t == "choice" and isinstance(v, list):
        return ", ".join(v)
    if t == "checkbox":
        return "Ja" if v else "Nein"
    if t == "profile" and isinstance(v, dict):
        return v.get("handle") or v.get("id") or v.get("url") or ""
    if t == "person":
        return (names or {}).get(v, v)
    if t == "ref" and isinstance(v, dict):
        if v.get("type") == "service":
            return (names or {}).get("svc:" + str(v.get("id")), v.get("id"))
        return (names or {}).get(v.get("id"), v.get("id"))
    return str(v)


# ---------------------------------------------------------------- Verlauf

def record(uid, owner_type, owner_id, attr, old, new, source="manual", value_id=None, at=None):
    if old == new:
        return
    db.insert("history", {"user_id": uid, "owner_type": owner_type, "owner_id": owner_id, "attr": attr,
                          "value_id": value_id, "old": db.jd(old) if old is not None else None,
                          "new": db.jd(new) if new is not None else None, "at": at or now(),
                          "source": source})


# ---------------------------------------------------------------- Werte

def _vrow(r):
    return {"id": r["id"], "value": db.jl(r["value"]), "label": r["label"], "primary": bool(r["is_primary"]),
            "deprecated": bool(r["deprecated"]), "uncertain": bool(r["uncertain"]), "source": r["source"],
            "valid_from": r["valid_from"], "valid_to": r["valid_to"], "recorded_at": r["recorded_at"]}


def get_values(owner_type, owner_id, include_deprecated=True) -> dict:
    sql = "SELECT * FROM field_values WHERE owner_type=? AND owner_id=?"
    if not include_deprecated:
        sql += " AND deprecated=0"
    out = {}
    for r in db.q(sql + " ORDER BY is_primary DESC, position, recorded_at", owner_type, owner_id):
        out.setdefault(r["field_id"], []).append(_vrow(r))
    return out


def primary(vals: list | None):
    if not vals:
        return None
    live = [v for v in vals if not v["deprecated"]]
    if not live:
        return None
    return next((v for v in live if v["primary"]), live[0])


def _touch(owner_type, owner_id):
    tbl = {"entity": "entities", "bund": "bunds", "circle": "circles"}[owner_type]
    db.ex(f"UPDATE {tbl} SET updated_at=? WHERE id=?", now(), owner_id)


def set_values(uid, owner_type, owner_id, d: dict, values: list, source="manual", country="49"):
    """Ersetzt alle Werte eines Feldes. Werte mit id werden aktualisiert, ohne id angelegt, fehlende gelöscht."""
    fid = d["id"]
    with db.tx():
        existing = {r["id"]: r for r in db.q(
            "SELECT * FROM field_values WHERE owner_type=? AND owner_id=? AND field_id=?", owner_type, owner_id, fid)}
        if not d["multi"]:
            live = [v for v in values if not v.get("deprecated")]
            if len(live) > 1:
                raise Bad(f"{d['name']} hat nur einen Wert")
        keep = set()
        has_primary = any(v.get("primary") and not v.get("deprecated") for v in values)
        for i, v in enumerate(values):
            nv = normalize_value(uid, d, v.get("value"), country)
            if nv is None:
                continue
            row = {"value": db.jd(nv), "label": v.get("label") or None,
                   "is_primary": int(bool(v.get("primary")) if has_primary else (i == 0)),
                   "deprecated": int(bool(v.get("deprecated"))), "uncertain": int(bool(v.get("uncertain"))),
                   "valid_from": parse_date(v.get("valid_from")) if v.get("valid_from") else None,
                   "valid_to": parse_date(v.get("valid_to")) if v.get("valid_to") else None, "position": i}
            if not d["multi"]:
                row["is_primary"] = 1
            vid = v.get("id")
            if vid and vid in existing:
                old = existing[vid]
                changed = {k: x for k, x in row.items() if old[k] != x}
                if "value" in changed:
                    changed["source"] = v.get("source") or source
                    record(uid, owner_type, owner_id, fid, db.jl(old["value"]), nv, changed["source"], vid)
                elif any(k in changed for k in ("deprecated", "uncertain", "label", "valid_from", "valid_to")):
                    meta_old = {k: old[k] for k in changed if k not in ("position", "is_primary")}
                    meta_new = {k: changed[k] for k in changed if k not in ("position", "is_primary")}
                    if meta_new:
                        record(uid, owner_type, owner_id, fid + ":meta", meta_old, meta_new, source, vid)
                db.update("field_values", {"id": vid}, changed)
                keep.add(vid)
            else:
                vid = new_id("v", 10)
                db.insert("field_values", {"id": vid, "user_id": uid, "owner_type": owner_type,
                                           "owner_id": owner_id, "field_id": fid, "source": v.get("source") or source,
                                           "recorded_at": now(), **row})
                record(uid, owner_type, owner_id, fid, None, nv, v.get("source") or source, vid)
                keep.add(vid)
        for vid, old in existing.items():
            if vid not in keep:
                db.ex("DELETE FROM field_values WHERE id=?", vid)
                record(uid, owner_type, owner_id, fid, db.jl(old["value"]), None, source, vid)
        if fid == "f_via":
            _via_circles(uid, owner_type, owner_id, existing.values(), values, source)
        _touch(owner_type, owner_id)


def _via_circles(uid, owner_type, owner_id, old_rows, values, source):
    """„Kennengelernt über“ einen Kreis → die Person kommt in diesen Kreis (nur bei neu gesetztem Kreis,
    damit eine später beendete Mitgliedschaft nicht wieder auflebt)."""
    def circ(v):
        return v.get("id") if isinstance(v, dict) and v.get("type") == "circle" else None
    before = {circ(db.jl(r["value"])) for r in old_rows} - {None}
    new = [c for c in (circ(v.get("value")) for v in values if not v.get("deprecated")) if c and c not in before]
    if not new:
        return
    if owner_type == "bund":
        b = db.q1("SELECT a_id, b_id FROM bunds WHERE id=? AND user_id=?", owner_id, uid)
        me = self_id(uid)
        eid = (b["b_id"] if b["a_id"] == me else b["a_id"]) if b else None
    else:
        eid = owner_id
    if not eid or eid == self_id(uid):
        return
    for cid in new:
        if db.val("SELECT 1 FROM circles WHERE id=? AND user_id=?", cid, uid):
            add_member(uid, cid, eid, source=source)


def add_entity_date(uid, eid, fid, day: str, source="manual"):
    """Fügt einem (Mehrfach-)Datumsfeld einen Tag hinzu – z.B. ein Treffen. Derselbe Tag zählt nur einmal."""
    d = fdef(uid, fid)
    ot, oid = owner_for(uid, eid, d)
    cur = get_values(ot, oid).get(fid, [])
    if any(v["value"] == day and not v.get("deprecated") for v in cur):
        return
    if not d["multi"]:
        return set_single(uid, ot, oid, d, day, source)
    keep = [{k: v[k] for k in ("id", "value", "label", "primary", "deprecated", "uncertain", "valid_from", "valid_to") if k in v} for v in cur]
    for v in keep:
        v["primary"] = False
    set_values(uid, ot, oid, d, [{"value": day, "primary": True, "source": source}] + keep, source)


def set_single(uid, owner_type, owner_id, d: dict, value, source="manual", uncertain=None, label=None):
    """Setzt den Hauptwert eines Feldes (bei Mehrfachfeldern: ersetzt nur den Hauptwert)."""
    cur = get_values(owner_type, owner_id).get(d["id"], [])
    vals = [dict(v) for v in cur]
    p = primary(vals)
    if value is None or value == "":
        vals = [v for v in vals if p is None or v["id"] != p["id"]]
    elif p:
        p = next(v for v in vals if v["id"] == p["id"])
        if p["value"] != value or (source != p["source"] and source == "manual"):
            p["value"] = value
            p["source"] = source
        if uncertain is not None:
            p["uncertain"] = uncertain
        if label is not None:
            p["label"] = label
    else:
        vals.insert(0, {"value": value, "primary": True, "uncertain": bool(uncertain), "label": label,
                        "source": source})
    set_values(uid, owner_type, owner_id, d, vals, source)


def add_value(uid, owner_type, owner_id, d: dict, value, source="manual", label=None, uncertain=False):
    vals = get_values(owner_type, owner_id).get(d["id"], [])
    if not d["multi"]:
        return set_single(uid, owner_type, owner_id, d, value, source, uncertain, label)
    set_values(uid, owner_type, owner_id, d, vals + [{"value": value, "label": label, "uncertain": uncertain,
                                                      "source": source, "primary": not vals}], source)


# ---------------------------------------------------------------- Lebewesen

def get_entity(uid, eid) -> dict:
    e = db.q1("SELECT * FROM entities WHERE id=? AND user_id=?", eid, uid)
    if not e:
        raise HTTPException(404, "Eintrag nicht gefunden")
    e["aliases"] = db.jl(e["aliases"], []) or []
    return e


def self_id(uid) -> str:
    return db.val("SELECT id FROM entities WHERE user_id=? AND is_self=1", uid)


def display_name(e) -> str:
    return e.get("name") or e.get("description") or "Ohne Namen"


def self_bund(uid, eid, create=False):
    me = self_id(uid)
    if eid == me:
        return None
    b = db.q1("SELECT * FROM bunds WHERE user_id=? AND ((a_id=? AND b_id=?) OR (a_id=? AND b_id=?))", uid, me, eid,
              eid, me)
    if b or not create:
        return b
    bid = new_id("b")
    db.insert("bunds", {"id": bid, "user_id": uid, "a_id": me, "b_id": eid, "kind_id": None, "created_at": now(),
                        "updated_at": now()})
    return db.q1("SELECT * FROM bunds WHERE id=?", bid)


def owner_for(uid, eid, d) -> tuple[str, str]:
    """Bund-Felder an einer Person landen am Bund mit dir ("Ihr zwei")."""
    if d["scope"] == "bund":
        b = self_bund(uid, eid, create=True)
        if not b:
            raise Bad("Dein eigener Eintrag hat kein „Ihr zwei“")
        return ("bund", b["id"])
    if d["scope"] == "kreis":
        raise Bad("Kreis-Feld an Person")
    return ("entity", eid)


def set_entity_field(uid, eid, fid, value, source="manual", uncertain=None):
    d = fdef(uid, fid)
    ot, oid = owner_for(uid, eid, d)
    set_single(uid, ot, oid, d, value, source, uncertain)
    if ot == "bund":
        _touch("entity", eid)


def level_of(uid, eid):
    b = self_bund(uid, eid)
    if not b:
        return None
    p = primary(get_values("bund", b["id"]).get("f_level"))
    return p["value"] if p else None


def split_name(name):
    parts = (name or "").split()
    if not parts:
        return None, None, None
    return parts[0], (" ".join(parts[1:-1]) or None), (parts[-1] if len(parts) > 1 else None)


def compose_name(first, middle, last):
    return " ".join(x.strip() for x in (first, middle, last) if x and x.strip()) or None


def ordered_name(e, order="first"):
    """Anzeige je nach Einstellung: „Vorname Nachname“ oder „Nachname, Vorname“."""
    if order == "last" and e.get("last_name") and e.get("first_name"):
        return f"{e['last_name']}, {compose_name(e['first_name'], e.get('middle_names'), None)}"
    return e.get("name") or e.get("description") or "Ohne Namen"


def create_entity(uid, name=None, kind="person", description=None, name_uncertain=False, source="manual",
                  created_at=None) -> str:
    if kind not in ("person", "pet"):
        raise Bad("Art muss person oder pet sein")
    if not (name or description):
        raise Bad("Name oder Beschreibung fehlt")
    eid = new_id("p")
    t = created_at or now()
    first, middle, last = split_name(name)
    db.insert("entities", {"id": eid, "user_id": uid, "kind": kind, "name": (name or "").strip() or None,
                           "first_name": first, "middle_names": middle, "last_name": last,
                           "name_uncertain": int(bool(name_uncertain)),
                           "description": (description or "").strip() or None, "aliases": "[]", "created_at": t,
                           "updated_at": t})
    record(uid, "entity", eid, "created", None, {"name": name, "description": description, "kind": kind}, source)
    return eid


ENTITY_PROPS = ("name", "name_uncertain", "description", "aliases", "avatar", "main_circle_id", "on_phone", "kind",
                "valid_from", "valid_to", "first_name", "middle_names", "last_name")
NAME_PARTS = ("first_name", "middle_names", "last_name")


def patch_entity(uid, eid, changes: dict, source="manual"):
    e = get_entity(uid, eid)
    changes = dict(changes)
    # Namensteile und Gesamtname immer gemeinsam pflegen
    if any(k in changes for k in NAME_PARTS):
        parts = {k: ((changes[k] if k in changes else e[k]) or "").strip() or None for k in NAME_PARTS}
        changes.update(parts)
        changes["name"] = compose_name(parts["first_name"], parts["middle_names"], parts["last_name"])
    elif "name" in changes:
        f, m, l = split_name(changes["name"])
        changes.update({"first_name": f, "middle_names": m, "last_name": l})
    upd = {}
    for k in ENTITY_PROPS:
        if k not in changes:
            continue
        v = changes[k]
        if k == "kind":
            if e["is_self"] and v != "person":
                raise Bad("Dein eigener Eintrag bleibt eine Person")
            if v not in ("person", "pet"):
                raise Bad("Art muss person oder pet sein")
        if k in ("name_uncertain", "on_phone"):
            v = int(bool(v))
        if k == "aliases":
            v = [a.strip() for a in (v or []) if a and a.strip()]
        if k in ("name", "description", *NAME_PARTS):
            v = (v or "").strip() or None
        if k in ("valid_from", "valid_to") and v:
            v = parse_date(v)
        if k == "main_circle_id" and v:
            if not db.val("SELECT 1 FROM circles WHERE id=? AND user_id=?", v, uid):
                raise Bad("Kreis unbekannt")
        if e[k] != v:
            upd[k] = v
    # Name nachgetragen: alte Beschreibung bleibt als Alias
    if "name" in upd and upd["name"] and not e["name"] and e["description"]:
        al = list(upd.get("aliases", e["aliases"]))
        if e["description"] not in al:
            al.append(e["description"])
        upd["aliases"] = al
        upd.setdefault("description", None)
    if "name" in upd and e["name"] and upd["name"] and fold(e["name"]) != fold(upd["name"]):
        al = list(upd.get("aliases", e["aliases"]))
        if e["name"] not in al and not e["name_uncertain"]:
            pass  # bei Umbenennung bewusst kein Alias – nur alte Beschreibung bleibt
        upd.setdefault("aliases", al)
    if e["is_self"] and upd.get("name") is None and "name" in upd:
        raise Bad("Dein Eintrag braucht einen Namen")
    if not (upd.get("name", e["name"]) or upd.get("description", e["description"])):
        raise Bad("Name oder Beschreibung muss bleiben")
    with db.tx():
        for k, v in upd.items():
            record(uid, "entity", eid, k, e[k], v, source)
        if "aliases" in upd:
            upd["aliases"] = db.jd(upd["aliases"])
        if upd:
            upd["updated_at"] = now()
            db.update("entities", {"id": eid}, upd)
    # neuer Name → auch in Immich (nicht, wenn er gerade aus Immich kommt)
    if ("name" in upd or "name_uncertain" in upd) and source != "immich":
        from .importers.immich import push_names
        push_names(uid, eid)
    return upd


# ---------------------------------------------------------------- Kreise

def circles(uid) -> dict:
    return {c["id"]: c for c in db.q("SELECT * FROM circles WHERE user_id=?", uid)}


def circle_kinds(uid) -> dict:
    return {k["id"]: k for k in db.q("SELECT * FROM circle_kinds WHERE user_id=? ORDER BY position", uid)}


def active(m, on: str | None = None) -> bool:
    d = on or today()
    vf = m.get("valid_from") or (m.get("created_at") or "")[:10]
    vf_d = approx_date(vf) if vf and "?" in vf else vf
    if vf_d and str(vf_d) > d:
        return False
    vt = m.get("valid_to")
    if vt:
        vt_d = approx_date(vt) if "?" in vt else vt
        if vt_d and str(vt_d) < d:
            return False
    return True


def memberships_of(uid, eid, on=None, include_past=False):
    rows = db.q("SELECT * FROM memberships WHERE user_id=? AND entity_id=? ORDER BY valid_from", uid, eid)
    return rows if include_past else [m for m in rows if active(m, on)]


def add_member(uid, circle_id, eid, role=None, valid_from=None, source="manual"):
    c = db.q1("SELECT * FROM circles WHERE id=? AND user_id=?", circle_id, uid)
    if not c:
        raise HTTPException(404, "Kreis nicht gefunden")
    get_entity(uid, eid)
    cur = [m for m in db.q("SELECT * FROM memberships WHERE circle_id=? AND entity_id=?", circle_id, eid)
           if active(m)]
    if cur:
        m = cur[0]
        if m["valid_to"]:  # heute ausgetragen und gleich wieder eingetragen → Ende wieder weg
            db.ex("UPDATE memberships SET valid_to=NULL WHERE id=?", m["id"])
            record(uid, "entity", eid, "membership", {"circle": circle_id, "valid_to": m["valid_to"]}, {"circle": circle_id, "name": c["name"]}, source)
            _touch("entity", eid)
        return m["id"]
    mid = new_id("m")
    db.insert("memberships", {"id": mid, "user_id": uid, "circle_id": circle_id, "entity_id": eid, "role": role,
                              "valid_from": parse_date(valid_from) if valid_from else None, "valid_to": None,
                              "created_at": now()})
    record(uid, "entity", eid, "membership", None, {"circle": circle_id, "name": c["name"], "role": role}, source)
    e = db.q1("SELECT main_circle_id FROM entities WHERE id=?", eid)
    if not e["main_circle_id"]:
        db.ex("UPDATE entities SET main_circle_id=? WHERE id=?", circle_id, eid)
    _touch("entity", eid)
    return mid


def end_member(uid, mid, on=None, source="manual"):
    """Rausziehen aus einem Kreis setzt „bis heute“ und löscht nichts."""
    m = db.q1("SELECT * FROM memberships WHERE id=? AND user_id=?", mid, uid)
    if not m:
        raise HTTPException(404, "Mitgliedschaft nicht gefunden")
    end = parse_date(on) if on else today()
    db.ex("UPDATE memberships SET valid_to=? WHERE id=?", end, mid)
    c = db.q1("SELECT name FROM circles WHERE id=?", m["circle_id"])
    record(uid, "entity", m["entity_id"], "membership", {"circle": m["circle_id"], "name": c and c["name"]},
           {"circle": m["circle_id"], "name": c and c["name"], "until": end}, source)
    e = db.q1("SELECT main_circle_id FROM entities WHERE id=?", m["entity_id"])
    if e and e["main_circle_id"] == m["circle_id"]:
        rest = [x for x in memberships_of(uid, m["entity_id"]) if x["id"] != mid]
        db.ex("UPDATE entities SET main_circle_id=? WHERE id=?", rest[0]["circle_id"] if rest else None,
              m["entity_id"])
    _touch("entity", m["entity_id"])


# ---------------------------------------------------------------- „Ist“

def compute_ist(settings, seen, signals, meet):
    """Berechnetes „Ist“: Ring aus letztem Kontakt und Anzahl der Treffen.

    Ergebnis: {"ring": 1..4, "last": Datum, "days": Tage}
    """
    dates = []
    if seen and approx_date(seen):
        dates.append(approx_date(seen))
    for s in signals or []:
        try:
            dates.append(date.fromisoformat(s[:10]))
        except (TypeError, ValueError):
            pass
    if not dates:
        return None
    last = max(dates)
    days = (date.today() - last).days
    ring = 1 if days <= 7 else 2 if days <= 30 else 3 if days <= 120 else 4
    if (meet or 0) >= 25 and ring > 1:
        ring -= 1
    return {"ring": ring, "last": last.isoformat(), "days": days}


def long_unseen(settings, level, ist) -> bool:
    if not level or not ist:
        return False
    lim = (settings.get("unseen_days") or {}).get(str(int(level)))
    return bool(lim) and ist["days"] > lim


# ---------------------------------------------------------------- Listen

def load_rows(ctx, at: str | None = None, ids=None) -> list[dict]:
    """Alle Lebewesen mit Hauptwerten aller Felder – Grundlage für Liste, Tabelle und Visualisierungen.

    at: Datum für den Zeitregler. Dann zählen nur Einträge, Mitgliedschaften und Ringe, die damals galten.
    """
    uid = ctx.uid
    defs = field_defs(uid)
    ents = db.q("SELECT * FROM entities WHERE user_id=?", uid)
    if ids is not None:
        ids = set(ids)
        ents = [e for e in ents if e["id"] in ids]
    me = next((e["id"] for e in ents if e["is_self"]), None) or self_id(uid)
    names = {e["id"]: display_name(e) for e in db.q("SELECT id,name,description FROM entities WHERE user_id=?",
                                                     uid)}
    cs = circles(uid)
    names.update({c["id"]: c["name"] for c in cs.values()})
    names.update({"svc:" + k: v for k, v in source_names(uid).items()})
    vals = {}
    for r in db.q("SELECT * FROM field_values WHERE user_id=? AND deprecated=0 ORDER BY is_primary DESC, position",
                  uid):
        vals.setdefault((r["owner_type"], r["owner_id"]), {}).setdefault(r["field_id"], []).append(r)
    selfb = {}
    for b in db.q("SELECT * FROM bunds WHERE user_id=? AND (a_id=? OR b_id=?)", uid, me, me):
        other = b["b_id"] if b["a_id"] == me else b["a_id"]
        selfb[other] = b
    mems = {}
    for m in db.q("SELECT * FROM memberships WHERE user_id=?", uid):
        if active(m, at):
            mems.setdefault(m["entity_id"], []).append(m)
    # bearbeitet = mindestens eine eigene Eingabe (in syn, am Handy oder beim Zusammenführen)
    hand = "(source='manual' OR source LIKE 'Handy%' OR source='Zusammenführen')"
    edited = {r["owner_id"] for r in db.q(f"SELECT DISTINCT owner_id FROM history WHERE user_id=? AND owner_type='entity' AND {hand}", uid)}
    bund_edited = {r["owner_id"] for r in db.q(f"SELECT DISTINCT owner_id FROM history WHERE user_id=? AND owner_type='bund' AND {hand}", uid)}
    # Herkunft: mit welcher Quelle der Eintrag angelegt wurde (manual, Importer-ID, card …)
    origin = {r["owner_id"]: r["source"] for r in db.q("SELECT owner_id, source FROM history WHERE user_id=? "
                                                         "AND owner_type='entity' AND attr='created'", uid)}
    signals = {}
    for s in db.q("SELECT entity_id, at FROM contact_signals WHERE user_id=?", uid):
        signals.setdefault(s["entity_id"], []).append(s["at"])
    dupe_ids = set()
    level_hist = {}
    if at:
        # Ringe zum Stichtag: Verlauf rückwärts anwenden
        for h in db.q("SELECT * FROM history WHERE user_id=? AND owner_type='bund' AND attr='f_level' AND at>? "
                      "ORDER BY at DESC", uid, at + "T23:59:59Z"):
            level_hist[h["owner_id"]] = db.jl(h["old"])
    rows = []
    for e in ents:
        created = (e["valid_from"] or e["created_at"] or "")[:10]
        if at and created and created > at:
            continue
        v = {}
        ev = vals.get(("entity", e["id"]), {})
        b = selfb.get(e["id"])
        bv = vals.get(("bund", b["id"]), {}) if b else {}
        for fid, lst in list(ev.items()) + list(bv.items()):
            d = defs.get(fid)
            if not d:
                continue
            p = next((x for x in lst if x["is_primary"]), lst[0])
            raw = db.jl(p["value"])
            v[fid] = {"d": display(d, raw, names), "raw": raw, "u": bool(p["uncertain"]), "n": len(lst),
                      "s": p["source"]}
        level = v.get("f_level", {}).get("raw")
        if at and b and b["id"] in level_hist:
            level = level_hist[b["id"]]
        ms = mems.get(e["id"], [])
        circle_ids = [m["circle_id"] for m in ms]
        # Mitglied im Unterkreis zählt auch im Oberkreis
        eff = set(circle_ids)
        for cid in circle_ids:
            if cs.get(cid) and cs[cid]["parent_id"]:
                eff.add(cs[cid]["parent_id"])
        main = e["main_circle_id"] if e["main_circle_id"] in circle_ids else (circle_ids[0] if circle_ids else None)
        meet = (v.get("f_meet", {}).get("n") or 0) + int(float(v.get("f_meet_prev", {}).get("raw") or 0))  # Anzahl Treffen
        seen = v.get("f_seen", {}).get("raw")
        ist = compute_ist(ctx.settings, seen, signals.get(e["id"]), meet) if ctx.settings.get("use_ist") else None
        rows.append({
            "id": e["id"], "kind": e["kind"], "is_self": bool(e["is_self"]), "name": e["name"],
            "name_uncertain": bool(e["name_uncertain"]), "description": e["description"],
            "display": ordered_name(e, ctx.settings.get("name_order", "first")), "aliases": db.jl(e["aliases"], []), "avatar": e["avatar"],
            "first_name": e["first_name"], "middle_names": e["middle_names"], "last_name": e["last_name"],
            "main_circle_id": main, "circles": circle_ids, "circles_all": sorted(eff),
            "memberships": [{"id": m["id"], "circle_id": m["circle_id"], "role": m["role"],
                             "valid_from": m["valid_from"], "approx_from": not m["valid_from"],
                             "created_at": m["created_at"]} for m in ms],
            "on_phone": bool(e["on_phone"]), "created_at": e["created_at"], "updated_at": e["updated_at"],
            "level": level, "self_bund_id": b["id"] if b else None,
            "bund_kind": b["kind_id"] if b else None, "ist": ist,
            "long_unseen": long_unseen(ctx.settings, level, ist) if ist else False,
            "approx_created": not e["valid_from"], "v": v,
            "origin": origin.get(e["id"]) or "manual",
            "edited": bool(e["is_self"] or e["id"] in edited or (b and b["id"] in bund_edited)),
        })
    return rows


def search_match(row: dict, qtext: str, circle_names: dict) -> bool:
    if not qtext:
        return True
    q = fold(qtext)
    hay = [row["display"], row["description"] or "", *row["aliases"]]
    hay += [circle_names.get(c, "") for c in row["circles_all"]]
    hay += [x["d"] for x in row["v"].values() if isinstance(x.get("d"), str)]
    hay += [normalize_phone(x["d"]) for k, x in row["v"].items() if k == "f_phone"]
    text = fold(" | ".join(hay))
    return all(part in text for part in q.split())
