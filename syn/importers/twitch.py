from ..importe import Contact, Importer


class Twitch(Importer):
    id = "twitch"
    steps = [
        'Registriere eine Anwendung auf dev.twitch.tv/console und kopiere die Client-ID.',
        'Erzeuge einen User-Access-Token mit der Berechtigung user:read:follows (z.B. mit twitchtokengenerator.com).',
        'Trag Client-ID und Token hier ein.',
    ]
    name = "Twitch"
    way = "Helix API"
    official = "ja"
    brings = "gefolgte Kanäle"
    service = "twitch"
    config = [{"key": "client_id", "label": "Client-ID", "type": "text", "required": True,
               "help": "dev.twitch.tv → Anwendung registrieren"},
              {"key": "token", "label": "User-Access-Token (user:read:follows)", "type": "secret", "required": True}]

    def fetch(self, cfg, run):
        h = {"Client-Id": cfg["client_id"], "Authorization": f"Bearer {cfg['token']}"}
        me = run.get("https://api.twitch.tv/helix/users", headers=h).json()["data"][0]
        out, cursor = [], None
        while True:
            params = {"user_id": me["id"], "first": 100}
            if cursor:
                params["after"] = cursor
            r = run.get("https://api.twitch.tv/helix/channels/followed", headers=h, params=params).json()
            for c in r.get("data", []):
                out.append(Contact(service_id=c["broadcaster_id"], handle=c["broadcaster_login"],
                                   name=c["broadcaster_name"], friend_since=(c.get("followed_at") or "")[:10] or None))
            cursor = r.get("pagination", {}).get("cursor")
            if not cursor:
                return out


IMPORTER = Twitch()
