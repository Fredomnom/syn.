"""prate: gefolgte Nutzer, Follower, letzte Interaktion im Feed und deine privaten Notizen zu Leuten.

Nur der Token wird gebraucht. syn fragt zuerst https://prate.com/api ab und weicht auf
https://prate.fredomnom.com/api aus, wenn dort keine gültige Antwort kommt.
"""
from ..importe import Contact, Importer

BASES = ["https://prate.com/api", "https://prate.fredomnom.com/api"]


def _items(data, *keys):
    """Listen tolerant auslesen – direkt oder unter items/users/data/… verpackt."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in (*keys, "items", "users", "results", "data", "activities", "entries"):
            v = data.get(k)
            if isinstance(v, list):
                return v
    return []


def _abs(web, url):
    """prate liefert Bilder als relativen Pfad (/media/avatars/…) – auf den Server beziehen."""
    if not url or not isinstance(url, str):
        return None
    if url.startswith("//"):
        return "https:" + url
    return url if url.startswith("http") else web.rstrip("/") + "/" + url.lstrip("/")


def _user(u):
    if not isinstance(u, dict):
        return None
    return u.get("user") if isinstance(u.get("user"), dict) and not u.get("username") else u


class Prate(Importer):
    id = "prate"
    name = "prate"
    way = "offene API mit persönlichem Token"
    official = "ja"
    brings = "gefolgte Nutzer, Follower, letzte Interaktion im Feed, deine Notizen"
    service = "prate"
    rate = 0.15
    config = [{"key": "token", "label": "Persönlicher Token", "type": "secret", "required": True,
               "help": "In prate unter Einstellungen → Tokens erstellen (Lesen reicht)."}]
    steps = [
        "Öffne prate und melde dich an.",
        "Geh zu Einstellungen → Tokens (Personal Access Tokens).",
        "Erstelle einen neuen Token, Lesen reicht. Gib ihm einen Namen wie „syn“.",
        "Kopiere den Token und füge ihn hier ein.",
        "Klick auf „Importieren“ – syn findet den richtigen prate-Server selbst.",
    ]

    def _base(self, run, h):
        bases = ([run.state["base"]] if run.state.get("base") else []) + [b for b in BASES if b != run.state.get("base")]
        for b in bases:
            try:
                r = run.http.get(f"{b}/me", headers=h)
                if r.status_code == 200 and isinstance(r.json(), dict):
                    run.state["base"] = b
                    return b, r.json()
                run.log(f"{b}: HTTP {r.status_code}")
            except Exception as e:
                run.log(f"{b}: {e}")
        raise RuntimeError("Kein prate-Server hat den Token akzeptiert")

    def _all(self, run, url, h, *keys):
        out, cursor = [], None
        for _ in range(50):
            r = run.get(url, headers=h, params={"limit": 100, **({"cursor": cursor} if cursor else {})}).json()
            batch = _items(r, *keys)
            out += batch
            cursor = (r.get("next_cursor") or r.get("cursor")) if isinstance(r, dict) else None
            if not cursor or not batch:
                break
        return out

    def fetch(self, cfg, run):
        h = {"Authorization": f"Bearer {cfg['token'].strip()}", "Accept": "application/json"}
        base, me = self._base(run, h)
        me = _user(me) or me
        my = me.get("username") or me.get("handle")
        if not my:
            raise RuntimeError("prate hat keinen Benutzernamen geliefert")
        run.log(f"prate: {base} als @{my}")
        people = {}
        for path in ("following", "followers"):
            for u in self._all(run, f"{base}/users/{my}/{path}", h, path):
                u = _user(u)
                if not u or not (u.get("username") or u.get("id")):
                    continue
                if u.get("bot") or u.get("is_bot") or u.get("type") == "bot":
                    continue  # keine Bots
                people.setdefault(str(u.get("username") or u.get("id")), {"u": u, "last": None})
        run.progress(0, len(people), "Feed")
        try:
            for ev in _items(run.get(f"{base}/feed", headers=h, params={"scope": "following", "limit": 100}).json(), "activities"):
                u = _user(ev.get("user") or ev.get("actor") or ev.get("author") or {}) or {}
                key = str(u.get("username") or u.get("id") or "")
                at = ev.get("created_at") or ev.get("at") or ev.get("date")
                if key in people and at and (not people[key]["last"] or str(at) > people[key]["last"]):
                    people[key]["last"] = str(at)[:10]
        except Exception as e:
            run.log(f"Feed nicht lesbar: {e}")
        out = []
        for i, (key, p) in enumerate(people.items()):
            u = p["u"]
            note = None
            try:  # deine private Notiz zu der Person
                r = run.http.get(f"{base}/users/{u.get('username') or key}/note", headers=h)
                if r.status_code == 200:
                    j = r.json()
                    note = (j.get("note") or j.get("text") or j.get("body")) if isinstance(j, dict) else (j if isinstance(j, str) else None)
            except Exception:
                pass
            run.progress(i + 1, len(people), "Notizen")
            web = base.removesuffix("/api")
            out.append(Contact(service_id=str(u.get("id") or key), handle=u.get("username"),
                               name=u.get("display_name") or u.get("name") or u.get("username"),
                               url=u.get("url") or (f"{web}/@{u.get('username')}" if u.get("username") else None),
                               avatar_url=_abs(web, u.get("avatar_url") or u.get("avatar")), last_contact=p["last"], note=note or None))
        return out


IMPORTER = Prate()
