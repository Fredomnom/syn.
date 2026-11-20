"""Mitgelieferte Standarddaten pro Nutzer: Felder, Kreis-Arten, Bund-Arten, Routinen, Ansichten."""
from . import db
from .util import new_id, now

RING_NAMES = {"1": "Engste", "2": "Nah", "3": "Mittel", "4": "Weit"}

SERVICES = [
    {"id": "instagram", "name": "Instagram", "link": "https://instagram.com/{handle}"},
    {"id": "discord", "name": "Discord", "link": ""},
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
    "shortcuts": {},  # Aktion -> Tastenkombination, überschreibt die Standardbelegung
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
    ("f_meet", "both", "Treffen", "number", {}, 0),
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
    # dein eigener Eintrag
    db.insert("entities", {"id": new_id("p"), "user_id": uid, "kind": "person", "is_self": 1,
                           "name": display_name or "Ich", "created_at": t, "updated_at": t})
    # Routinen
    r_seen = new_id("r")
    r_meet = new_id("r")
    routines = [
        (r_seen, "Heute gesehen", {"type": "manual", "label": "Heute gesehen", "icon": "eye"}, [],
         [{"type": "set_today", "field": "f_seen"}, {"type": "increment", "field": "f_meet", "by": 1}], None),
        (r_meet, "+1 Treffen", {"type": "manual", "label": "+1", "icon": "plus"}, [],
         [{"type": "increment", "field": "f_meet", "by": 1}], None),
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
        ("Lose aufräumen", "people", "table", {"filter": "lose", "sort": "-created"}),
        ("Mögliche Doppelte", "people", "duplicates", {}),
        ("Engste Leute", "people", "list", {"max_level": 2}),
    ]
    for i, (name, tab, view, cfg) in enumerate(views):
        db.insert("saved_views", {"id": new_id("v"), "user_id": uid, "name": name, "tab": tab, "view": view,
                                  "config": db.jd(cfg), "position": i})
