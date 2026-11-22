"""Mitgelieferte Standarddaten pro Nutzer: Felder, Kreis-Arten, Bund-Arten, Routinen, Ansichten."""
from . import db
from .util import new_id, now

RING_NAMES = {"1": "Engste", "2": "Nah", "3": "Mittel", "4": "Weit"}

SERVICES = [
    {"id": "instagram", "name": "Instagram", "link": "https://instagram.com/{handle}"},
    {"id": "discord", "name": "Discord", "link": "https://discord.com/users/{id}"},
    {"id": "steam", "name": "Steam", "link": "https://steamcommunity.com/profiles/{id}"},
    {"id": "telegram", "name": "Telegram", "link": "https://t.me/{handle}"},
    {"id": "whatsapp", "name": "WhatsApp", "link": ""},
    {"id": "signal", "name": "Signal", "link": ""},
    {"id": "matrix", "name": "Matrix", "link": "https://matrix.to/#/{handle}"},
    {"id": "github", "name": "GitHub", "link": "https://github.com/{handle}"},
    {"id": "mastodon", "name": "Mastodon", "link": "{url}"},
    {"id": "bluesky", "name": "Bluesky", "link": "https://bsky.app/profile/{handle}"},
    {"id": "twitch", "name": "Twitch", "link": "https://twitch.tv/{handle}"},
    {"id": "xbox", "name": "Xbox", "link": ""},
    {"id": "psn", "name": "PlayStation", "link": ""},
    {"id": "linkedin", "name": "LinkedIn", "link": "{url}"},
    {"id": "facebook", "name": "Facebook", "link": "{url}"},
    {"id": "snapchat", "name": "Snapchat", "link": "https://snapchat.com/add/{handle}"},
    {"id": "anilist", "name": "AniList", "link": "https://anilist.co/user/{handle}"},
    {"id": "lastfm", "name": "Last.fm", "link": "https://last.fm/user/{handle}"},
    {"id": "prate", "name": "prate", "link": "{url}"},
    {"id": "vrchat", "name": "VRChat", "link": "https://vrchat.com/home/user/{id}"},
    {"id": "immich", "name": "Immich", "link": "{url}"},
    {"id": "google", "name": "Google", "link": ""},
]

DEFAULT_SETTINGS = {
    "setup_done": False,
    "use_levels": True,
    "use_ist": False,
    "sync": {"mode": "rule", "match": "any", "rules": [{"type": "level", "max": 3}]},
    "public_host": "",
    "country_code": "49",
    "dup_sensitivity": "medium",  # strong | medium | all
    "notes_enabled": False,
    "ring_names": RING_NAMES,
    "unseen_days": {"1": 14, "2": 30, "3": 90, "4": 365},
    "services": SERVICES,
    "routine_time": "08:00",
    "shortcuts": {},
    "map_provider": "osm",
    "name_order": "first",  # first: „Vorname Nachname“ · last: „Nachname, Vorname“  # osm | google | apple – wohin Adressen verlinken  # Aktion -> Tastenkombination, überschreibt die Standardbelegung
}

CIRCLE_KINDS = [
    ("familie", "Familie", "FA", "#FCE8E3", "#9A3412"),
    ("freundschaft", "Freundschaft", "FR", "#E6EEFF", "#1D3FB8"),
    ("schule", "Schule", "SC", "#EDE9FE", "#5B21B6"),
    ("arbeit", "Arbeit", "AR", "#E3F4EC", "#166534"),
    ("hobby", "Hobby", "HO", "#DDF4F2", "#0F5E59"),
]
LOSE_COLORS = ("#ECEEF2", "#4B5563")
# Weitere Paare nach demselben Muster (helle Fläche, dunkle Schrift aus derselben Familie)
EXTRA_PAIRS = [("#FCE7F3", "#9D174D"), ("#E0F2FE", "#075985"), ("#ECFCCB", "#3F6212"), ("#FFEDD5", "#9A3412"),
               ("#F3E8FF", "#6B21A8"), ("#E0E7FF", "#3730A3"), ("#FFE4E6", "#9F1239"), ("#CCFBF1", "#115E59")]

# Standardkreise für den Start – frei änder- und löschbar
DEFAULT_CIRCLES = [("Familie", "familie"), ("Freunde", "freundschaft"), ("Arbeit", "arbeit"), ("Schule & Uni", "schule"),
                   ("Sport & Hobby", "hobby")]


KIND_ICONS = {"familie": "home", "freundschaft": "heart", "schule": "book", "arbeit": "briefcase", "hobby": "dumbbell"}
BUND_ICONS = {"freundschaft": "heart", "partnerschaft": "rings2", "eltern_kind": "baby", "geschwister": "users", "verwandt": "tree",
              "kollegen": "briefcase", "bekannt": "wave", "mentor": "graduation", "halter": "paw", "trainingspartner": "dumbbell"}


def backfill_icons():
    """Symbole für die mitgelieferten Arten, wo noch keines gesetzt ist."""
    for kid, ic in KIND_ICONS.items():
        db.ex("UPDATE circle_kinds SET icon=? WHERE id=? AND icon IS NULL", ic, kid)
    for kid, ic in BUND_ICONS.items():
        db.ex("UPDATE bund_kinds SET icon=? WHERE id=? AND icon IS NULL", ic, kid)


def seed_circles(uid):
    t = now()
    for name, kind in DEFAULT_CIRCLES:
        db.insert("circles", {"id": new_id("c"), "user_id": uid, "name": name, "kind_id": kind, "parent_id": None,
                              "description": None, "created_at": t, "updated_at": t})


def backfill_meet_dates():
    """Einmalig: „Treffen“ war eine Zahl, jetzt eine Liste von Daten. Die alte Zahl bleibt als „Frühere Treffen
    (ohne Datum)“ erhalten; war „Zuletzt gesehen“ gesetzt, wird dieses Datum gleich ein echtes Treffen."""
    if db.val("SELECT value FROM instance WHERE key='meet_dates_v1'"):
        return
    with db.tx():
        for u in db.q("SELECT id FROM users"):
            uid = u["id"]
            d = db.q1("SELECT * FROM field_defs WHERE user_id=? AND id='f_meet'", uid)
            if not d:
                continue
            if not db.val("SELECT 1 FROM field_defs WHERE user_id=? AND id='f_meet_prev'", uid):
                pos = db.val("SELECT COALESCE(MAX(position), 0) + 1 FROM field_defs WHERE user_id=?", uid)
                db.insert("field_defs", {"user_id": uid, "id": "f_meet_prev", "scope": d["scope"], "name": "Frühere Treffen (ohne Datum)",
                                         "type": "number", "options": "{}", "multi": 0, "position": pos, "is_base": 1})
            if d["type"] == "number":
                for v in db.q("SELECT * FROM field_values WHERE user_id=? AND field_id='f_meet'", uid):
                    n = int(float(db.jl(v["value"]) or 0))
                    seen = db.val("SELECT value FROM field_values WHERE owner_type=? AND owner_id=? AND field_id='f_seen' "
                                  "AND deprecated=0 ORDER BY is_primary DESC LIMIT 1", v["owner_type"], v["owner_id"])
                    db.ex("DELETE FROM field_values WHERE id=?", v["id"])
                    if seen and n > 0:
                        db.insert("field_values", {**{k: v[k] for k in v if k not in ("id", "value", "label")},
                                                   "id": new_id("v", 10), "value": seen, "label": None, "is_primary": 1})
                        n -= 1
                    if n > 0:
                        db.insert("field_values", {**{k: v[k] for k in v if k not in ("id", "value", "field_id", "label")},
                                                   "id": new_id("v", 10), "field_id": "f_meet_prev", "value": db.jd(n), "label": None})
                db.ex("UPDATE field_defs SET type='date', multi=1 WHERE user_id=? AND id='f_meet'", uid)
            for r in db.q("SELECT id, actions FROM routines WHERE user_id=?", uid):
                acts = db.jl(r["actions"], []) or []
                new = [({"type": "add_today", "field": "f_meet"} if a.get("type") == "increment" and a.get("field") == "f_meet" else a) for a in acts]
                if new != acts:
                    db.ex("UPDATE routines SET actions=? WHERE id=?", db.jd(new), r["id"])
        db.ex("INSERT OR REPLACE INTO instance(key,value) VALUES('meet_dates_v1', ?)", now())


def backfill_new_services():
    """Neue mitgelieferte Dienste (z.B. VRChat) auch in schon gespeicherte Dienstlisten aufnehmen – jeden nur einmal,
    damit ein gelöschter Dienst nicht wiederkommt."""
    known = set(db.jl(db.val("SELECT value FROM instance WHERE key='services_known'"), None) or [])
    if not known:  # erster Lauf: alles bis auf neue Dienste gilt als bekannt
        known = {s["id"] for s in SERVICES} - {"vrchat", "immich"}
    new = [s for s in SERVICES if s["id"] not in known]
    if new:
        for u in db.q("SELECT id, settings FROM users"):
            st = db.jl(u["settings"], {}) or {}
            if "services" not in st:
                continue
            have = {s.get("id") for s in st["services"]}
            st["services"] += [dict(s) for s in new if s["id"] not in have]
            db.ex("UPDATE users SET settings=? WHERE id=?", db.jd(st), u["id"])
    db.ex("INSERT OR REPLACE INTO instance(key,value) VALUES('services_known', ?)", db.jd(sorted(known | {s["id"] for s in new})))


def backfill_services():
    """Einmalig: gespeicherte Dienstlisten bekommen neue Link-Vorlagen (z.B. Discord), wenn dort noch keine steht."""
    if db.val("SELECT value FROM instance WHERE key='services_links_v1'"):
        return
    defaults = {s["id"]: s for s in SERVICES}
    for u in db.q("SELECT id, settings FROM users"):
        st = db.jl(u["settings"], {}) or {}
        if "services" not in st:
            continue
        for s in st["services"]:
            if not s.get("link") and defaults.get(s.get("id"), {}).get("link"):
                s["link"] = defaults[s["id"]]["link"]
        db.ex("UPDATE users SET settings=? WHERE id=?", db.jd(st), u["id"])
    db.ex("INSERT OR REPLACE INTO instance(key,value) VALUES('services_links_v1', ?)", now())


def backfill_views():
    """Einmalig: Konten bekommen die Standardansicht „Neue Personen“."""
    if db.val("SELECT value FROM instance WHERE key='view_new_v1'"):
        return
    for u in db.q("SELECT id FROM users"):
        if not db.val("SELECT 1 FROM saved_views WHERE user_id=? AND config LIKE '%\"filter\":\"new\"%'", u["id"]):
            db.ex("UPDATE saved_views SET position=position+1 WHERE user_id=?", u["id"])
            db.insert("saved_views", {"id": new_id("v"), "user_id": u["id"], "name": "Neue Personen", "tab": "people", "view": "grid",
                                      "config": db.jd({"filter": "new", "sort": "-created"}), "position": 0})
    db.ex("INSERT OR REPLACE INTO instance(key,value) VALUES('view_new_v1', ?)", now())


def backfill_circles():
    """Einmalig: Konten ohne einen einzigen Kreis bekommen die Standardkreise."""
    if db.val("SELECT value FROM instance WHERE key='default_circles_v1'"):
        return
    for u in db.q("SELECT id FROM users"):
        if not db.val("SELECT 1 FROM circles WHERE user_id=?", u["id"]):
            seed_circles(u["id"])
    db.ex("INSERT OR REPLACE INTO instance(key,value) VALUES('default_circles_v1', ?)", now())


BUND_KINDS = [
    ("freundschaft", "Freundschaft", "Freund", "Freund"),
    ("partnerschaft", "Partnerschaft", "Partner", "Partner"),
    ("eltern_kind", "Eltern-Kind", "Elternteil", "Kind"),
    ("geschwister", "Geschwister", "Geschwister", "Geschwister"),
    ("verwandt", "Verwandt", "Verwandt", "Verwandt"),
    ("kollegen", "Kollegen", "Kollege", "Kollege"),
    ("bekannt", "Bekannt", "Bekannt", "Bekannt"),
    ("mentor", "Mentor", "Mentor", "Mentee"),
    ("halter", "Halter", "Halter", "Haustier"),
    ("trainingspartner", "Trainingspartner", "Trainingspartner", "Trainingspartner"),
]

# (id, scope, name, type, options, multi)
FIELDS = [
    ("f_seen", "both", "Zuletzt gesehen", "date", {}, 0),
    ("f_meet", "both", "Treffen", "date", {}, 1),          # jedes Treffen mit Datum → erscheint im Kalender
    ("f_meet_prev", "both", "Frühere Treffen (ohne Datum)", "number", {}, 0),
    ("f_bday", "both", "Geburtstag", "date", {}, 0),
    ("f_phone", "person", "Telefon", "phone", {"labels": ["privat", "Arbeit", "Uni"]}, 1),
    ("f_email", "person", "E-Mail", "email", {"labels": ["privat", "Arbeit", "Uni"]}, 1),
    ("f_addr", "person", "Adresse", "address", {"labels": ["privat", "Arbeit"]}, 1),
    ("f_city", "person", "Wohnort", "text", {}, 0),
    ("f_profile", "person", "Profil", "profile", {"labels": ["Main", "Alt"]}, 1),
    ("f_company", "person", "Firma", "text", {}, 0),
    ("f_position", "person", "Position", "text", {}, 0),
    ("f_study", "person", "Studiert", "choice", {"choices": [], "multiple": False}, 0),
    ("f_food", "person", "Lieblingsessen", "choice", {"choices": [], "multiple": True}, 0),
    ("f_train", "both", "Trainiert", "choice",
     {"choices": ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
      "multiple": True}, 0),
    ("f_traits", "both", "Merkmale", "text", {}, 0),
    ("f_intro", "person", "Hat mich vorgestellt", "person", {}, 0),
    ("f_species", "pet", "Tierart", "choice",
     {"choices": ["Hund", "Katze", "Pferd", "Kaninchen", "Vogel", "Fisch", "Andere"], "multiple": False}, 0),
    ("f_breed", "pet", "Rasse", "text", {}, 0),
    ("f_note", "both", "Notiz", "note", {}, 0),
    # Felder am Bund (beim Bund mit dir: "Ihr zwei")
    ("f_level", "bund", "Ring", "number", {"min": 1, "max": 4, "ring": True}, 0),
    ("f_met", "bund", "Kennengelernt", "date", {}, 0),
    ("f_via", "bund", "Kennengelernt über", "ref", {}, 0),
    ("f_anniv", "bund", "Jahrestag", "date", {}, 0),
    # Felder am Kreis
    ("f_cplace", "kreis", "Ort", "text", {}, 0),
    ("f_cnote", "kreis", "Notiz", "note", {}, 0),
]


def seed_user(uid: str, display_name: str = "Ich"):
    t = now()
    for i, (cid, name, abbr, bg, fg) in enumerate(CIRCLE_KINDS):
        db.insert("circle_kinds", {"user_id": uid, "id": cid, "name": name, "abbr": abbr, "bg": bg, "fg": fg,
                                   "position": i})
    for i, (bid, name, ra, rb) in enumerate(BUND_KINDS):
        db.insert("bund_kinds", {"user_id": uid, "id": bid, "name": name, "role_a": ra, "role_b": rb,
                                 "position": i})
    for i, (fid, scope, name, typ, opts, multi) in enumerate(FIELDS):
        db.insert("field_defs", {"user_id": uid, "id": fid, "scope": scope, "name": name, "type": typ,
                                 "options": db.jd(opts), "multi": multi, "position": i, "is_base": 1})
    seed_circles(uid)
    backfill_icons()
    # dein eigener Eintrag
    db.insert("entities", {"id": new_id("p"), "user_id": uid, "kind": "person", "is_self": 1,
                           "name": display_name or "Ich", "created_at": t, "updated_at": t})
    # Routinen
    r_seen = new_id("r")
    r_meet = new_id("r")
    routines = [
        (r_seen, "Heute gesehen", {"type": "manual", "label": "Heute gesehen", "icon": "eye"}, [],
         [{"type": "set_today", "field": "f_seen"}, {"type": "add_today", "field": "f_meet"}], None),
        (r_meet, "+1 Treffen", {"type": "manual", "label": "+1", "icon": "plus"}, [],
         [{"type": "add_today", "field": "f_meet"}], None),
        (new_id("r"), "Geburtstag enger Leute",
         {"type": "date", "field": "f_bday", "repeat": "yearly", "without_year": True, "feb29": "feb28",
          "offset_days": 0, "time": "08:00"},
         [{"field": "f_level", "op": "<=", "value": 2}],
         [{"type": "card", "title": "{name} hat Geburtstag", "text": "{alter}"}], None),
        (new_id("r"), "Lange nicht gesehen",
         {"type": "schedule", "every": "weekly", "weekday": 0, "time": "08:00"},
         [{"field": "f_level", "op": "<=", "value": 2}, {"field": "f_seen", "op": "days_since_gt", "value": 30}],
         [{"type": "list", "title": "Lange nicht gesehen"}], None),
    ]
    for rid, name, trig, conds, acts, system in routines:
        db.insert("routines", {"id": rid, "user_id": uid, "name": name, "enabled": 1, "trigger": db.jd(trig),
                               "conditions": db.jd(conds), "actions": db.jd(acts), "created_at": t,
                               "system": system})
    db.ex("UPDATE field_defs SET quick_routine_id=? WHERE user_id=? AND id='f_seen'", r_seen, uid)
    db.ex("UPDATE field_defs SET quick_routine_id=? WHERE user_id=? AND id='f_meet'", r_meet, uid)
    views = [
        ("Neue Personen", "people", "grid", {"filter": "new", "sort": "-created"}),
        ("Lose aufräumen", "people", "table", {"filter": "lose", "sort": "-created"}),
        ("Mögliche Doppelte", "people", "duplicates", {}),
        ("Engste Leute", "people", "list", {"max_level": 2}),
    ]
    for i, (name, tab, view, cfg) in enumerate(views):
        db.insert("saved_views", {"id": new_id("v"), "user_id": uid, "name": name, "tab": tab, "view": view,
                                  "config": db.jd(cfg), "position": i})
