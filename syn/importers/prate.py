from ..importe import Contact, Importer


class Prate(Importer):
    id = "prate"
    name = "prate"
    way = "offene API mit Bearer-Token aus den prate-Einstellungen"
    official = "ja"
    brings = "gefolgte Nutzer, Follower, letzte Interaktion im Feed"
    service = "prate"
    config = [
        {"key": "token", "label": "API-Token", "type": "secret", "required": True,
         "help": "In prate unter Einstellungen → API erstellen"},
        {"key": "base", "label": "API-Basis-URL", "type": "text", "required": True,
         "help": "Basis-URL der prate-API, z.B. https://prate.example/api/v1"},
        {"key": "following_path", "label": "Pfad: gefolgte Nutzer", "type": "text", "placeholder": "/me/following"},
        {"key": "followers_path", "label": "Pfad: Follower", "type": "text", "placeholder": "/me/followers"},
        {"key": "feed_path", "label": "Pfad: Feed", "type": "text", "placeholder": "/me/feed"},
    ]

    def _list(self, run, url, headers):
        out, nxt = [], url
        while nxt:
            r = run.get(nxt, headers=headers).json()
            items = r if isinstance(r, list) else r.get("items") or r.get("data") or r.get("users") or []
            out += items
            nxt = r.get("next") if isinstance(r, dict) else None
        return out

    def fetch(self, cfg, run):
        base = cfg["base"].rstrip("/")
        h = {"Authorization": f"Bearer {cfg['token']}", "Accept": "application/json"}
        people = {}

        def add(u, rel):
            uid = str(u.get("id") or u.get("handle") or u.get("username"))
            p = people.setdefault(uid, {"u": u, "rel": set(), "last": None})
            p["rel"].add(rel)

        for u in self._list(run, base + (cfg.get("following_path") or "/me/following"), h):
            add(u, "following")
        for u in self._list(run, base + (cfg.get("followers_path") or "/me/followers"), h):
            add(u, "follower")
        try:
            for ev in self._list(run, base + (cfg.get("feed_path") or "/me/feed"), h)[:500]:
                u = ev.get("user") or ev.get("author") or {}
                uid = str(u.get("id") or u.get("handle") or u.get("username") or "")
                at = ev.get("created_at") or ev.get("at") or ev.get("date")
                if uid in people and at and (not people[uid]["last"] or at > people[uid]["last"]):
                    people[uid]["last"] = at
        except Exception as e:
            run.log(f"Feed nicht lesbar: {e}")
        out = []
        for uid, p in people.items():
            u = p["u"]
            out.append(Contact(service_id=uid, handle=u.get("handle") or u.get("username"),
                               name=u.get("name") or u.get("display_name") or u.get("handle"),
                               url=u.get("url"), avatar_url=u.get("avatar") or u.get("avatar_url"),
                               last_contact=(p["last"] or "")[:10] or None))
        return out


IMPORTER = Prate()
