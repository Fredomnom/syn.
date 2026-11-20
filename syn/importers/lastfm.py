from ..importe import Contact, Importer


class LastFm(Importer):
    id = "lastfm"
    steps = [
        'Erstelle auf last.fm/api/account/create einen API-Account und kopiere den API-Key.',
        'Trag deinen Last.fm-Namen und den Key hier ein.',
        'Klick auf „Importieren“.',
    ]
    name = "Last.fm"
    way = "API"
    official = "ja"
    brings = "gefolgte Nutzer"
    service = "lastfm"
    config = [{"key": "username", "label": "Dein Last.fm-Name", "type": "text", "required": True},
              {"key": "api_key", "label": "API-Key", "type": "secret", "required": True,
               "help": "last.fm/api/account/create"}]

    def fetch(self, cfg, run):
        out, page = [], 1
        while True:
            r = run.get("https://ws.audioscrobbler.com/2.0/", params={
                "method": "user.getfriends", "user": cfg["username"], "api_key": cfg["api_key"], "format": "json",
                "limit": 200, "page": page}).json()
            fr = r.get("friends", {})
            for u in fr.get("user", []):
                img = next((i["#text"] for i in u.get("image", []) if i.get("size") == "large" and i.get("#text")),
                           None)
                out.append(Contact(service_id=u["name"], handle=u["name"], name=u.get("realname") or u["name"],
                                   url=u.get("url"), avatar_url=img))
            attr = fr.get("@attr", {})
            if page >= int(attr.get("totalPages", 1)):
                return out
            page += 1


IMPORTER = LastFm()
