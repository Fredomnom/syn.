from ..importe import Contact, Importer, snowflake_date


class Discord(Importer):
    id = "discord"
    name = "Discord"
    way = "Nutzer-Token aus der Browser-Konsole"
    official = "nein"
    brings = "Freunde, DMs, letzte Nachricht"
    service = "discord"
    unofficial = True
    rate = 1.5
    risk = ("Discord verbietet das Automatisieren normaler Nutzerkonten außerhalb von OAuth2 und Bot-API und kann "
            "dafür Konten sperren. Die offizielle Freundesliste (relationships.read) braucht eine Freigabe durch "
            "Discord. syn liest nur, selten und mit niedriger Rate – das Risiko bleibt bei dir.")
    config = [
        {"key": "token", "label": "Nutzer-Token", "type": "secret", "required": True,
         "help": "Discord im Browser → Entwicklertools → Netzwerk → eine Anfrage an /api → Header „Authorization“"},
    ]

    def fetch(self, cfg, run):
        h = {"Authorization": cfg["token"].strip()}
        api = "https://discord.com/api/v9"
        rel = run.get(f"{api}/users/@me/relationships", headers=h).json()
        people = {}
        for r in rel:
            if r.get("type") != 1:  # 1 = Freund
                continue
            u = r.get("user", {})
            people[u["id"]] = {"u": u, "since": (r.get("since") or "")[:10] or None, "last": None,
                               "nick": r.get("nickname")}
        for ch in run.get(f"{api}/users/@me/channels", headers=h).json():
            if ch.get("type") != 1:
                continue
            for u in ch.get("recipients", []):
                p = people.setdefault(u["id"], {"u": u, "since": None, "last": None, "nick": None})
                if ch.get("last_message_id"):
                    p["last"] = snowflake_date(ch["last_message_id"])
        out = []
        for uid, p in people.items():
            u = p["u"]
            av = f"https://cdn.discordapp.com/avatars/{uid}/{u['avatar']}.png?size=256" if u.get("avatar") else None
            out.append(Contact(service_id=uid, handle=u.get("username"),
                               name=p["nick"] or u.get("global_name") or u.get("username"), avatar_url=av,
                               friend_since=p["since"], last_contact=p["last"]))
        return out


IMPORTER = Discord()
