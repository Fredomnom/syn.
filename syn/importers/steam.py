from ..importe import Contact, Importer, to_date


class Steam(Importer):
    id = "steam"
    name = "Steam"
    way = "eigenes Web-API-Token einfügen, liest wie das eingeloggte Konto"
    official = "Endpunkte ja, Token nein"
    brings = "Freunde mit Freundschafts-Datum"
    service = "steam"
    unofficial = True
    rate = 1.0
    risk = ("Das Token wird aus deinem eingeloggten Steam-Konto kopiert und ist kein offizieller API-Key. "
            "syn liest damit nur und langsam. Ein normaler API-Key liefert die Freundesliste nur bei öffentlichem "
            "Profil (sonst Fehler 401).")
    config = [
        {"key": "token", "label": "Web-API-Token", "type": "secret", "required": True,
         "help": "Eingeloggt öffnen: https://store.steampowered.com/pointssummary/ajaxgetasyncconfig – "
                 "Wert von „webapi_token“ kopieren. Alternativ ein normaler API-Key (nur öffentliche Profile)."},
        {"key": "steamid", "label": "Deine SteamID64", "type": "text", "required": True},
    ]

    def fetch(self, cfg, run):
        tok = cfg["token"].strip()
        auth = {"access_token": tok} if len(tok) > 40 else {"key": tok}
        r = run.get("https://api.steampowered.com/ISteamUser/GetFriendList/v1/",
                    params={**auth, "steamid": cfg["steamid"], "relationship": "friend"}).json()
        friends = r.get("friendslist", {}).get("friends", [])
        out = []
        for i in range(0, len(friends), 100):
            chunk = friends[i:i + 100]
            s = run.get("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
                        params={**auth, "steamids": ",".join(f["steamid"] for f in chunk)}).json()
            info = {p["steamid"]: p for p in s.get("response", {}).get("players", [])}
            for f in chunk:
                p = info.get(f["steamid"], {})
                out.append(Contact(service_id=f["steamid"], handle=p.get("personaname"),
                                   name=p.get("realname") or p.get("personaname"), url=p.get("profileurl"),
                                   avatar_url=p.get("avatarfull"), friend_since=to_date(f.get("friend_since"))))
        return out


IMPORTER = Steam()
