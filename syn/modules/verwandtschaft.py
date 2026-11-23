"""Verwandtschaft rechnen: aus eingetragenen Familien-Bünden folgen weitere.

Die Mutter deiner Mutter ist deine Oma – das muss niemand von Hand eintragen. syn liest die Rollenwörter der Bünde
(„Mutter“, „Kind“, „Opa“, „Schwester“ …), macht daraus Grundschritte und rechnet Wege:

  U = Elternteil (hoch)   D = Kind (runter)   S = Geschwister   P = Partner

Abgeleitete Bünde werden NICHT gespeichert, sondern bei Bedarf berechnet. Fällt eine Verbindung weg, verschwindet,
was daraus folgte, von selbst. „Stimmt“ macht einen abgeleiteten Bund zu einem echten, „Stimmt nicht“ blendet ihn aus.
Nur Familie: aus Freundschaft & Co. folgt nichts.
"""
import re
from collections import deque

from fastapi import APIRouter, Depends

from .. import db, model
from ..auth import Ctx, current, user_settings

router = APIRouter(prefix="/api/v1", tags=["Bünde"])

MAX_STEPS = 4  # länger wird unübersichtlich (Großcousin dritten Grades …)

# Rollenwort → (Weg vom Gegenüber zu dieser Person, Geschlecht der Person)
# Beispiel: Bund A–B mit role_a = „Mutter“ → A ist Elternteil von B → von B nach A geht es „U“.
_ROLES = [
    (r"mutter|mama|mami|mutti|mum|mom", "U", "f"), (r"vater|papa|papi|vati|dad", "U", "m"), (r"eltern(teil)?|parent", "U", None),
    (r"tochter", "D", "f"), (r"sohn", "D", "m"), (r"kind|child", "D", None),
    (r"oma|omi|großmutter|grossmutter|grandma", "UU", "f"), (r"opa|opi|großvater|grossvater|grandpa", "UU", "m"), (r"großeltern(teil)?|grosseltern(teil)?", "UU", None),
    (r"uroma|urgroßmutter", "UUU", "f"), (r"uropa|urgroßvater", "UUU", "m"),
    (r"enkelin", "DD", "f"), (r"enkel(kind)?", "DD", None),
    (r"schwester", "S", "f"), (r"bruder", "S", "m"), (r"geschwister(teil)?|sibling", "S", None),
    (r"ehefrau|partnerin|verlobte|gattin", "P", "f"), (r"ehemann|verlobter|gatte", "P", "m"), (r"partner|ehepartner|verheiratet|spouse", "P", None),
    (r"tante", "US", "f"), (r"onkel", "US", "m"),
    (r"nichte", "SD", "f"), (r"neffe", "SD", "m"),
    (r"cousine|kusine", "USD", "f"), (r"cousin|kusin", "USD", None),
    (r"schwiegermutter", "PU", "f"), (r"schwiegervater", "PU", "m"), (r"schwiegereltern(teil)?", "PU", None),
    (r"schwiegertochter", "DP", "f"), (r"schwiegersohn", "DP", "m"),
    (r"schwägerin", "SP", "f"), (r"schwager", "SP", "m"),
]
_ROLE_RE = [(re.compile(rf"^(?:{p})$"), path, g) for p, path, g in _ROLES]
_INV = {"U": "D", "D": "U", "S": "S", "P": "P"}

# Weg (vereinfacht) → Bezeichnung (weiblich, männlich, neutral)
LABELS = {
    "U": ("Mutter", "Vater", "Elternteil"), "D": ("Tochter", "Sohn", "Kind"), "S": ("Schwester", "Bruder", "Geschwister"),
    "P": ("Partnerin", "Partner", "Partner"),
    "UU": ("Oma", "Opa", "Großelternteil"), "DD": ("Enkelin", "Enkel", "Enkelkind"),
    "UUU": ("Uroma", "Uropa", "Urgroßelternteil"), "DDD": ("Urenkelin", "Urenkel", "Urenkelkind"),
    "US": ("Tante", "Onkel", "Tante/Onkel"), "SD": ("Nichte", "Neffe", "Nichte/Neffe"),
    "USD": ("Cousine", "Cousin", "Cousin/Cousine"),
    "UUS": ("Großtante", "Großonkel", "Großtante/-onkel"), "SDD": ("Großnichte", "Großneffe", "Großnichte/-neffe"),
    "PU": ("Schwiegermutter", "Schwiegervater", "Schwiegerelternteil"), "DP": ("Schwiegertochter", "Schwiegersohn", "Schwiegerkind"),
    "SP": ("Schwägerin", "Schwager", "Schwager/Schwägerin"), "PS": ("Schwägerin", "Schwager", "Schwager/Schwägerin"),
    "PUU": ("Schwieger-Oma", "Schwieger-Opa", "Schwiegergroßelternteil"),
}


def role_path(word):
    w = (word or "").strip().lower().replace("-", "").replace(" ", "")
    for rx, path, g in _ROLE_RE:
        if rx.match(w):
            return path, g
    return None, None


def simplify(path: str) -> str | None:
    """Wege kürzen: Elternteil des Kindes … Ergibt None, wenn der Weg nichts Eindeutiges sagt."""
    prev = None
    while prev != path:
        prev = path
        path = path.replace("UD", "S")   # Kind meines Elternteils = Geschwister (oder ich selbst – fängt der Aufrufer ab)
        path = path.replace("SS", "S")   # Geschwister meiner Geschwister
        path = path.replace("SU", "U")   # Elternteil meiner Geschwister = mein Elternteil
        path = path.replace("DS", "D")   # Geschwister meines Kindes = mein Kind
        path = path.replace("PP", "")
    if "DU" in path or "PD" in path or "UP" in path:
        return None  # Elternteil meines Kindes, Kind meines Partners, Partner meines Elternteils: zu unsicher
    return path or None


def _edges(uid):
    """Familien-Kanten aus den echten Bünden: id → [(nachbar, weg, bund_id)] und Geschlechts-Hinweise."""
    adj, gender, direct = {}, {}, set()
    for b in db.q("SELECT id, a_id, b_id, role_a, role_b FROM bunds WHERE user_id=? AND (valid_to IS NULL OR valid_to='')", uid):
        a, bb = b["a_id"], b["b_id"]
        direct.add(frozenset((a, bb)))
        pa, ga = role_path(b["role_a"])   # was a für b ist
        pb, gb = role_path(b["role_b"])   # was b für a ist
        if ga:
            gender.setdefault(a, ga)
        if gb:
            gender.setdefault(bb, gb)
        if not pa and pb:                 # nur eine Seite benannt: die andere ergibt sich
            pa = "".join(_INV[c] for c in reversed(pb))
        if not pb and pa:
            pb = "".join(_INV[c] for c in reversed(pa))
        if pa and pb:
            adj.setdefault(bb, []).append((a, pa, b["id"]))
            adj.setdefault(a, []).append((bb, pb, b["id"]))
    return adj, gender, direct


def _label(path, g):
    lab = LABELS.get(path)
    if not lab:
        return None
    return lab[0] if g == "f" else lab[1] if g == "m" else lab[2]


def derive(uid, only: str | None = None):
    """Alle ableitbaren Verwandtschaften (ohne bestehende Bünde und ausgeblendete)."""
    adj, gender, direct = _edges(uid)
    hidden = set(user_settings(uid).get("kin_hidden", []))
    starts = [only] if only else list(adj)
    out = {}
    for s in starts:
        if s not in adj:
            continue
        # Breitensuche über Personen; Weg = aneinandergereihte Grundschritte, über = Zwischenpersonen
        q = deque([(s, "", [s])])
        while q:
            cur, path, via = q.popleft()
            for nb, step, _ in adj.get(cur, []):
                if nb in via:
                    continue
                np = path + step
                if len(np) > MAX_STEPS + 2:
                    continue
                q.append((nb, np, via + [nb]))
                if len(via) < 2:
                    continue  # direkte Verbindung – gibt es schon
                key = frozenset((s, nb))
                if key in direct or f"{min(s, nb)}|{max(s, nb)}" in hidden:
                    continue
                sp = simplify(np)
                if not sp or len(sp) > MAX_STEPS:
                    continue
                back = "".join(_INV[c] for c in reversed(sp))
                lab_nb, lab_s = _label(sp, gender.get(nb)), _label(simplify(back) or back, gender.get(s))
                if not lab_nb:
                    continue
                k = (s, nb) if only else tuple(sorted((s, nb)))
                if k in out and len(out[k]["via"]) <= len(via) - 1:  # via ohne Ziel: Zwischenpersonen = via[1:]
                    continue  # kürzester Weg reicht
                a, b = k
                out[k] = {"a_id": a, "b_id": b,
                          "role_a": lab_nb if a == nb else lab_s, "role_b": lab_s if a == nb else lab_nb,
                          "via": via[1:] if a == s else list(reversed(via[1:])), "derived": True}
    return list(out.values())


@router.get("/kin")
def kin(entity_id: str | None = None, ctx: Ctx = Depends(current)):
    """Abgeleitete Verwandtschaft – für eine Person oder alle (fürs Netz)."""
    rows = derive(ctx.uid, entity_id)
    names = {r["id"]: model.display_name(r) for r in db.q("SELECT id, name, description FROM entities WHERE user_id=?", ctx.uid)}
    for r in rows:
        r["via_names"] = [names.get(i, "?") for i in r["via"]]
    return rows


@router.post("/kin/confirm")
def confirm(body: dict, ctx: Ctx = Depends(current)):
    """„Stimmt“: wird ein echter Bund (Art „Verwandt“, mit den berechneten Rollen)."""
    from .buende import bund_out, create_bund
    a, b = body["a_id"], body["b_id"]
    hit = next((r for r in derive(ctx.uid, a) if r["b_id"] == b or r["a_id"] == b), None)
    if not hit:
        from ..model import Bad
        raise Bad("Diese Verwandtschaft lässt sich gerade nicht ableiten")
    kind = "verwandt" if db.val("SELECT 1 FROM bund_kinds WHERE user_id=? AND id='verwandt'", ctx.uid) else None
    with db.tx():
        bid = create_bund(ctx.uid, hit["a_id"], hit["b_id"], kind, hit["role_a"], hit["role_b"], source="Verwandtschaft")
    return bund_out(ctx.uid, db.q1("SELECT * FROM bunds WHERE id=?", bid))


@router.post("/kin/hide")
def hide(body: dict, ctx: Ctx = Depends(current)):
    """„Stimmt nicht“: diese Ableitung nicht mehr zeigen (z.B. Patchwork, Adoption)."""
    a, b = sorted((body["a_id"], body["b_id"]))
    raw = db.jl(db.val("SELECT settings FROM users WHERE id=?", ctx.uid), {}) or {}
    raw["kin_hidden"] = sorted(set(raw.get("kin_hidden", [])) | {f"{a}|{b}"})
    db.ex("UPDATE users SET settings=? WHERE id=?", db.jd(raw), ctx.uid)
    return {"ok": True}
