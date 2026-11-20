from ..importe import Contact, Importer


class Xbox(Importer):
    id = "xbox"
    name = "Xbox"
    way = "OpenXBL"
    official = "nein"
    brings = "Freunde"
    service = "xbox"
    unofficial = True
    risk = "OpenXBL ist ein Drittanbieter, der für dich bei Xbox Live angemeldet ist. syn liest nur."
    rate = 1.0
    config = [{"key": "key", "label": "OpenXBL-API-Key", "type": "secret", "required": True, "help": "xbl.io"}]

    def fetch(self, cfg, run):
        r = run.get("https://xbl.io/api/v2/friends", headers={"X-Authorization": cfg["key"],
                                                              "Accept": "application/json"}).json()
        people = r.get("people") or r.get("content", {}).get("people", [])
        return [Contact(service_id=p["xuid"], handle=p.get("gamertag"),
                        name=p.get("realName") or p.get("displayName") or p.get("gamertag"),
                        avatar_url=p.get("displayPicRaw")) for p in people]


IMPORTER = Xbox()
