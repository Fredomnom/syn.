"""Gemeinsamer Rahmen für alle Importer.

Jeder Importer ist ein eigenes Modul in syn/importers/ mit einer Variable IMPORTER. Er liefert Kontakte,
der Rahmen ordnet sie zu:
  * Bekannte erkennt er an der Dienst-ID im Profil-Feld, an Telefonnummer oder E-Mail (auch veraltete Werte).
  * Neue Leute landen unter „Lose“. Unsichere Treffer schlägt die Dubletten-Erkennung vor, nie automatisch.
  * Er schreibt nur Werte aus seiner eigenen Quelle und überschreibt nie, was du von Hand gesetzt hast.
  * Freundschafts-Datum → Vorschlag für „Kennengelernt“. Letzte Nachricht → Signal fürs „Ist“.
"""
import importlib
import logging
import pkgutil
import time
from dataclasses import dataclass, field
from datetime import date, datetime

import httpx

from . import config, crypto, db, model
from .util import new_id, normalize_email, normalize_phone, now, parse_date

log = logging.getLogger("syn.importe")


@dataclass
class Contact:
    service_id: str | None = None
    name: str | None = None
    handle: str | None = None
    url: str | None = None
    phones: list = field(default_factory=list)  # Nummer oder (Nummer, Label)
    emails: list = field(default_factory=list)
    birthday: str | None = None
    avatar_url: str | None = None
    avatar_bytes: bytes | None = None
    avatar_headers: dict | None = None
    friend_since: str | None = None
    last_contact: str | None = None  # Datum der letzten Nachricht/Interaktion
    seen: str | None = None  # gemeinsamer Termin → „zuletzt gesehen“-Signal
    fields: dict = field(default_factory=dict)  # Feld-ID -> Wert (z.B. f_company, f_position, f_addr)
    service: str | None = None  # Dienst fürs Profil-Feld, falls abweichend vom Importer
    only_existing: bool = False  # nur bekannte Personen aktualisieren, keine neuen anlegen
    groups: list = field(default_factory=list)  # Gruppen/Räume, in denen die Person mit dir ist (→ Kreis-Vorschläge)


class Importer:
    id = ""
    name = ""
    way = ""  # Weg, z.B. „offene API mit Bearer-Token“
    official = "ja"  # ja | nein | Export ja | Datei | Endpunkte ja, Token nein
    brings = ""  # Was reinkommt
    service = None  # Dienst-ID fürs Profil-Feld
    unofficial = False
    risk = ""  # Hinweis, der beim Einrichten einmal bestätigt werden muss
    config: list = []  # [{"key","label","type":"text|secret|number|select|textarea","help","required","options"}]
    accepts_files = False
    file_hint = ""
    needs = None  # z.B. "google" für die OAuth-Verbindung
    rate = 0.0  # Sekunden Pause zwischen Anfragen (inoffizielle Wege: niedrige Rate)
    requires = []  # optionale Python-Pakete

    def fetch(self, cfg: dict, run: "Run"):
        raise NotImplementedError

    def meta(self):
        missing = []
        for p in self.requires:
            try:
                importlib.import_module(p)
            except ImportError:
                missing.append(p)
        return {"id": self.id, "name": self.name, "way": self.way, "official": self.official,
                "brings": self.brings, "unofficial": self.unofficial, "risk": self.risk, "config": self.config,
                "accepts_files": self.accepts_files, "file_hint": self.file_hint, "needs": self.needs,
                "missing_packages": missing, "service": self.service}


class Run:
    """Kontext eines Laufs: Log, hochgeladene Dateien, Zustand, HTTP mit Rate-Limit."""

    def __init__(self, ctx, imp: Importer, files=None, state=None):
        self.ctx = ctx
        self.imp = imp
        self.files = files or []  # [(name, bytes)]
        self.state = state or {}
        self.lines = []
        self._last = 0.0
        self.http = httpx.Client(timeout=30, follow_redirects=True,
                                 headers={"User-Agent": "syn-contacts/1.0 (+self-hosted)"})

    def log(self, msg):
        self.lines.append(f"{datetime.now().strftime('%H:%M:%S')} {msg}")

    def _wait(self):
        if self.imp.rate:
            d = time.monotonic() - self._last
            if d < self.imp.rate:
                time.sleep(self.imp.rate - d)
            self._last = time.monotonic()

    def get(self, url, **kw):
        self._wait()
        r = self.http.get(url, **kw)
        if r.status_code == 429:
            wait = float(r.headers.get("retry-after", "5"))
            self.log(f"Rate-Limit, warte {wait:.0f}s")
            time.sleep(min(wait, 60))
            r = self.http.get(url, **kw)
        r.raise_for_status()
        return r

    def post(self, url, **kw):
        self._wait()
        r = self.http.post(url, **kw)
        r.raise_for_status()
        return r

    def request(self, method, url, **kw):
        self._wait()
        r = self.http.request(method, url, **kw)
        r.raise_for_status()
        return r


_registry = None


def all_importers() -> dict:
    global _registry
    if _registry is None:
        from . import importers
        reg = {}
        for m in pkgutil.iter_modules(importers.__path__):
            try:
                mod = importlib.import_module(f"syn.importers.{m.name}")
            except Exception:  # ein kaputtes Modul darf den Rest nicht verhindern
                log.exception("Importer %s konnte nicht geladen werden", m.name)
                continue
            imp = getattr(mod, "IMPORTER", None)
            if imp:
                reg[imp.id] = imp
        _registry = dict(sorted(reg.items(), key=lambda kv: kv[1].name.lower()))
    return _registry


def globally_disabled() -> set:
    off = set(config.DISABLED_IMPORTERS)
    off |= set(db.jl(db.val("SELECT value FROM instance WHERE key='disabled_importers'"), []) or [])
    return off


def registry() -> dict:
    off = globally_disabled()
    return {k: v for k, v in all_importers().items() if k not in off}


def get_config(uid, iid) -> dict:
    row = db.q1("SELECT * FROM importer_configs WHERE user_id=? AND importer_id=?", uid, iid)
    return crypto.unseal(uid, row["config_enc"], {}) if row else {}


# ---------------------------------------------------------------- Zuordnen und Schreiben

def _index(uid, country):
    svc, phones, emails = {}, {}, {}
    types = {d["id"]: d["type"] for d in db.q("SELECT id, type FROM field_defs WHERE user_id=?", uid)}
    for r in db.q("SELECT owner_id, field_id, value FROM field_values WHERE user_id=? AND owner_type='entity'", uid):
        t = types.get(r["field_id"])
        v = db.jl(r["value"])
        if t == "profile" and isinstance(v, dict):
            for k in ("id", "handle"):
                if v.get(k):
                    svc[f"{v.get('service')}:{str(v[k]).lower()}"] = r["owner_id"]
        elif t == "phone":
            n = normalize_phone(v, country)
            if n:
                phones.setdefault(n, r["owner_id"])
        elif t == "email":
            emails.setdefault(normalize_email(v), r["owner_id"])
    return svc, phones, emails


def _set_if_allowed(ctx, eid, d, value, source, stats):
    """Setzt einen Einzelwert nur, wenn leer oder aus derselben Quelle."""
    ot, oid = model.owner_for(ctx.uid, eid, d)
    cur = model.primary(model.get_values(ot, oid).get(d["id"]))
    try:
        nv = model.normalize_value(ctx.uid, d, value)
    except Exception:
        return
    if nv is None:
        return
    if cur is None:
        model.set_single(ctx.uid, ot, oid, d, nv, source)
        stats["values"] += 1
    elif cur["source"] == source and cur["value"] != nv:
        model.set_single(ctx.uid, ot, oid, d, nv, source)
        stats["values"] += 1


def _add_multi(ctx, eid, d, value, source, label, stats, norm):
    vals = model.get_values("entity", eid).get(d["id"], [])
    if any(norm(v["value"]) == norm(value) for v in vals):
        return
    model.set_values(ctx.uid, "entity", eid, d, vals + [{"value": value, "label": label, "source": source,
                                                         "primary": not vals}], source)
    stats["values"] += 1


def apply_contacts(ctx, imp: Importer, contacts, run: Run):
    from .modules.dateien import store_bytes
    from .modules.vorschlaege import add_suggestion
    uid = ctx.uid
    country = ctx.settings.get("country_code", "49")
    defs = model.field_defs(uid)
    src = imp.id
    stats = {"seen": 0, "new": 0, "matched": 0, "values": 0, "suggestions": 0, "signals": 0}
    svc_idx, ph_idx, em_idx = _index(uid, country)
    me = model.self_id(uid)
    group_members = {}
    for c in contacts:
        stats["seen"] += 1
        service = c.service or imp.service
        eid = None
        if service and c.service_id:
            eid = svc_idx.get(f"{service}:{str(c.service_id).lower()}")
        if not eid and service and c.handle:
            eid = svc_idx.get(f"{service}:{str(c.handle).lower()}")
        idmap = run.state.setdefault("map", {})
        if not eid and not service and c.service_id:
            eid = idmap.get(str(c.service_id))
        phones = [(p, None) if isinstance(p, str) else tuple(p) for p in c.phones if p]
        emails = [(e, None) if isinstance(e, str) else tuple(e) for e in c.emails if e]
        if not eid:
            for p, _ in phones:
                eid = ph_idx.get(normalize_phone(p, country))
                if eid:
                    break
        if not eid:
            for e, _ in emails:
                eid = em_idx.get(normalize_email(e))
                if eid:
                    break
        if eid == me:
            continue
        with db.tx():
            if eid and not db.val("SELECT 1 FROM entities WHERE id=?", eid):
                eid = None
            if eid:
                stats["matched"] += 1
                e = db.q1("SELECT * FROM entities WHERE id=?", eid)
                if c.name and not e["name"]:
                    if add_suggestion(uid, "name", eid, {"value": c.name}, src):
                        stats["suggestions"] += 1
            else:
                name = c.name or c.handle or c.service_id
                if not name or c.only_existing:
                    continue
                eid = model.create_entity(uid, name=name, source=src)
                stats["new"] += 1
                # Neu über diesen Dienst: „Kennengelernt über“ zeigt auf die Quelle (Handeingaben gewinnen später)
                if "f_via" in defs:
                    try:
                        model.set_entity_field(uid, eid, "f_via", {"type": "service", "id": service or imp.id}, src)
                    except Exception as ex:
                        run.log(f"Kennengelernt über: {ex}")
            if not service and c.service_id:
                idmap[str(c.service_id)] = eid
            if service and (c.service_id or c.handle) and "f_profile" in defs:
                prof = {"service": service, "handle": c.handle or "", "id": c.service_id or "", "url": c.url or ""}
                prof = {k: v for k, v in prof.items() if v}
                vals = model.get_values("entity", eid).get("f_profile", [])
                same = [v for v in vals if isinstance(v["value"], dict) and v["value"].get("service") == service and
                        ((c.service_id and v["value"].get("id") == c.service_id) or
                         (c.handle and v["value"].get("handle") == c.handle))]
                if not same:
                    model.set_values(uid, "entity", eid, defs["f_profile"],
                                     vals + [{"value": prof, "label": "Main" if not vals else None, "source": src,
                                              "primary": not vals}], src)
                    stats["values"] += 1
                elif same[0]["source"] == src and same[0]["value"] != prof:
                    for v in vals:
                        if v["id"] == same[0]["id"]:
                            v["value"] = prof
                    model.set_values(uid, "entity", eid, defs["f_profile"], vals, src)
                    stats["values"] += 1
                if c.service_id:
                    svc_idx[f"{service}:{str(c.service_id).lower()}"] = eid
            if "f_phone" in defs:
                for p, label in phones:
                    _add_multi(ctx, eid, defs["f_phone"], p, src, label, stats, lambda x: normalize_phone(x, country))
                    ph_idx.setdefault(normalize_phone(p, country), eid)
            if "f_email" in defs:
                for m, label in emails:
                    _add_multi(ctx, eid, defs["f_email"], m, src, label, stats, normalize_email)
                    em_idx.setdefault(normalize_email(m), eid)
            if c.birthday and "f_bday" in defs:
                _set_if_allowed(ctx, eid, defs["f_bday"], c.birthday, src, stats)
            for fid, v in (c.fields or {}).items():
                d = defs.get(fid)
                if not d or v in (None, ""):
                    continue
                if d["multi"]:
                    _add_multi(ctx, eid, d, v, src, None, stats, lambda x: str(x).strip().lower())
                else:
                    _set_if_allowed(ctx, eid, d, v, src, stats)
            if (c.avatar_url or c.avatar_bytes) and not db.val("SELECT avatar FROM entities WHERE id=?", eid):
                try:
                    data, mime = c.avatar_bytes, "image/jpeg"
                    if not data:
                        r = run.http.get(c.avatar_url, headers=c.avatar_headers or {})
                        if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"):
                            data, mime = r.content, r.headers["content-type"].split(";")[0]
                    if data:
                        fid = store_bytes(uid, data, mime)
                        model.patch_entity(uid, eid, {"avatar": f"/api/v1/files/{fid}"}, src)
                except Exception as ex:
                    run.log(f"Profilbild für {c.name}: {ex}")
            if c.friend_since:
                fs = parse_date(c.friend_since[:10] if len(str(c.friend_since)) > 10 else c.friend_since)
                if fs:
                    sb = model.self_bund(uid, eid)
                    met = model.primary(model.get_values("bund", sb["id"]).get("f_met")) if sb else None
                    if not met and add_suggestion(uid, "field", eid, {"field": "f_met", "value": fs,
                                                                     "why": f"Freundschaft auf {imp.name} seit"}, src):
                        stats["suggestions"] += 1
            for g in c.groups or []:
                group_members.setdefault(g, set()).add(eid)
            for kind, val in (("message", c.last_contact), ("seen", c.seen)):
                if val:
                    d = str(val)[:10]
                    cur = db.val("SELECT at FROM contact_signals WHERE entity_id=? AND source=? AND kind=?", eid, src,
                                 kind)
                    if not cur or cur < d:
                        db.ex("INSERT OR REPLACE INTO contact_signals(user_id,entity_id,source,kind,at) "
                              "VALUES(?,?,?,?,?)", uid, eid, src, kind, d)
                        stats["signals"] += 1
    stats["groups"] = suggest_groups(uid, imp.service or imp.id, src, group_members)
    return stats


def suggest_groups(uid, service, src, group_members) -> int:
    """Gruppen mit mindestens zwei bekannten Leuten als Kreis vorschlagen – nie automatisch anlegen."""
    n = 0
    for name, ids in group_members.items():
        ids = sorted(ids)
        if len(ids) < 2 or not name:
            continue
        cur = [s for s in db.q("SELECT * FROM suggestions WHERE user_id=? AND kind='group_circle'", uid)
               if (db.jl(s["payload"], {}) or {}).get("name") == name and db.jl(s["payload"], {}).get("service") == service]
        payload = {"name": name, "service": service, "members": ids}
        if cur:
            if cur[0]["status"] == "open":
                db.ex("UPDATE suggestions SET payload=? WHERE id=?", db.jd(payload), cur[0]["id"])
            continue
        db.insert("suggestions", {"id": new_id("s"), "user_id": uid, "kind": "group_circle", "entity_id": None,
                                  "payload": db.jd(payload), "source": src, "created_at": now(), "status": "open"})
        n += 1
    return n


def backfill_via():
    """Einmalig: Für früher importierte Leute „Kennengelernt über“ aus der Quelle des ersten Eintrags nachtragen."""
    if db.val("SELECT value FROM instance WHERE key='backfill_via_v1'"):
        return
    imps = all_importers()
    for u in db.q("SELECT id FROM users"):
        uid = u["id"]
        if not db.val("SELECT 1 FROM field_defs WHERE user_id=? AND id='f_via'", uid):
            continue
        for h in db.q("SELECT owner_id, source FROM history WHERE user_id=? AND owner_type='entity' AND attr='created'", uid):
            imp = imps.get(h["source"])
            if not imp or not db.val("SELECT 1 FROM entities WHERE id=?", h["owner_id"]):
                continue
            sb = model.self_bund(uid, h["owner_id"])
            if sb and db.val("SELECT 1 FROM field_values WHERE owner_type='bund' AND owner_id=? AND field_id='f_via'", sb["id"]):
                continue
            try:
                model.set_entity_field(uid, h["owner_id"], "f_via", {"type": "service", "id": imp.service or imp.id}, imp.id)
            except Exception:
                log.exception("Nachtragen für %s", h["owner_id"])
    db.ex("INSERT OR REPLACE INTO instance(key,value) VALUES('backfill_via_v1', ?)", now())


def run_importer(ctx, iid, files=None) -> str:
    imp = registry().get(iid)
    if not imp:
        return f"Importer {iid} ist ausgeschaltet oder unbekannt"
    row = db.q1("SELECT * FROM importer_configs WHERE user_id=? AND importer_id=?", ctx.uid, iid)
    if not row or not row["enabled"]:
        return f"{imp.name}: nicht eingerichtet"
    cfg = crypto.unseal(ctx.uid, row["config_enc"], {})
    state = db.jl(row["state"], {}) or {}
    run = Run(ctx, imp, files, state)
    status = "ok"
    stats = {}
    try:
        meta = imp.meta()
        if meta["missing_packages"]:
            raise RuntimeError(f"Fehlende Pakete: {', '.join(meta['missing_packages'])} (pip install …)")
        if imp.accepts_files and not files and not any(c.get("required") for c in imp.config):
            raise RuntimeError("Dieser Importer braucht eine Datei. Lade sie in den Einstellungen hoch.")
        contacts = list(imp.fetch(cfg, run))
        run.log(f"{len(contacts)} Kontakte gelesen")
        stats = apply_contacts(ctx, imp, contacts, run)
        status = (f"{stats['seen']} gelesen, {stats['new']} neu, {stats['matched']} erkannt, "
                  f"{stats['values']} Werte, {stats['suggestions']} Vorschläge"
                  + (f", {stats['groups']} Gruppen-Vorschläge" if stats.get("groups") else ""))
    except httpx.HTTPStatusError as e:
        status = f"Fehler: HTTP {e.response.status_code} von {e.request.url.host}"
        run.log(status + " " + e.response.text[:300])
    except Exception as e:
        log.exception("Import %s", iid)
        status = f"Fehler: {e}"
        run.log(status)
    finally:
        run.http.close()
    run.log(status)
    db.ex("UPDATE importer_configs SET last_run_at=?, last_status=?, last_log=?, state=? WHERE user_id=? AND "
          "importer_id=?", now(), status, "\n".join(run.lines[-200:]), db.jd(run.state), ctx.uid, iid)
    return f"{imp.name}: {status}"


def to_date(ts) -> str | None:
    """Unix-Sekunden/-Millisekunden oder ISO → YYYY-MM-DD"""
    if ts in (None, "", 0):
        return None
    try:
        if isinstance(ts, (int, float)) or str(ts).isdigit():
            t = float(ts)
            if t > 1e11:
                t /= 1000
            return date.fromtimestamp(t).isoformat()
        return str(ts)[:10]
    except (ValueError, OSError):
        return None


def snowflake_date(sid) -> str | None:
    """Discord-Snowflake → Datum"""
    try:
        return to_date(((int(sid) >> 22) + 1420070400000) / 1000)
    except (TypeError, ValueError):
        return None
