from ..importe import Contact, Importer


class Mastodon(Importer):
    id = "mastodon"
    steps = [
        'Mastodon → Einstellungen → Entwicklung → „Neue Anwendung“.',
        'Name „syn“, Berechtigungen nur read:accounts und read:follows.',
        'Speichern und den „Zugangs-Token“ kopieren.',
        'Trag Instanz (z.B. https://mastodon.social) und Token hier ein.',
    ]
    name = "Mastodon"
    way = "Mastodon API"
    official = "ja"
    brings = "gegenseitige Follows"
    service = "mastodon"
    config = [{"key": "instance", "label": "Instanz", "type": "text", "required": True,
               "placeholder": "https://mastodon.social"},
              {"key": "token", "label": "Access-Token (Lesen)", "type": "secret", "required": True,
               "help": "Einstellungen → Entwicklung → Neue Anwendung, Berechtigung read:accounts, read:follows"},
              {"key": "only_mutual", "label": "Nur gegenseitige Follows", "type": "select", "options": ["ja", "nein"]}]

    def _all(self, run, url, h):
        out = []
        while url and len(out) < 10000:
            r = run.get(url, headers=h, params={"limit": 80} if "?" not in url else None)
            out += r.json()
            url = r.links.get("next", {}).get("url")
        return out

    def fetch(self, cfg, run):
        base = cfg["instance"].rstrip("/")
        if not base.startswith("http"):
            base = "https://" + base
        h = {"Authorization": f"Bearer {cfg['token']}"}
        me = run.get(f"{base}/api/v1/accounts/verify_credentials", headers=h).json()
        following = {a["id"]: a for a in self._all(run, f"{base}/api/v1/accounts/{me['id']}/following", h)}
        followers = {a["id"]: a for a in self._all(run, f"{base}/api/v1/accounts/{me['id']}/followers", h)}
        ids = set(following) & set(followers) if cfg.get("only_mutual", "ja") == "ja" else \
            set(following) | set(followers)
        host = base.split("//")[1]
        out = []
        for i in ids:
            a = following.get(i) or followers[i]
            acct = a["acct"] if "@" in a["acct"] else f"{a['acct']}@{host}"
            out.append(Contact(service_id=acct, handle="@" + acct, name=a.get("display_name") or a["username"],
                               url=a.get("url"), avatar_url=a.get("avatar"), bot=bool(a.get("bot"))))
        return out


IMPORTER = Mastodon()
