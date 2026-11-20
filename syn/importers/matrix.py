from urllib.parse import quote

from ..importe import Contact, Importer, to_date


class Matrix(Importer):
    id = "matrix"
    name = "Matrix"
    way = "Client-Server-API"
    official = "ja"
    brings = "DMs, Räume"
    service = "matrix"
    rate = 0.2
    config = [
        {"key": "homeserver", "label": "Homeserver", "type": "text", "required": True,
         "placeholder": "https://matrix.org"},
        {"key": "token", "label": "Access-Token", "type": "secret", "required": True,
         "help": "Element → Einstellungen → Hilfe & Info → Zugriffstoken"},
        {"key": "rooms", "label": "Auch Mitglieder kleiner Räume (bis N Personen)", "type": "number",
         "placeholder": "0"},
    ]

    def fetch(self, cfg, run):
        hs = cfg["homeserver"].rstrip("/")
        h = {"Authorization": f"Bearer {cfg['token']}"}
        me = run.get(f"{hs}/_matrix/client/v3/account/whoami", headers=h).json()["user_id"]
        direct = {}
        try:
            direct = run.get(f"{hs}/_matrix/client/v3/user/{quote(me)}/account_data/m.direct", headers=h).json()
        except Exception:
            run.log("Keine m.direct-Daten")
        people = {}
        for uid, rooms in direct.items():
            last = None
            for rid in rooms[:3]:
                try:
                    msgs = run.get(f"{hs}/_matrix/client/v3/rooms/{quote(rid)}/messages",
                                   params={"dir": "b", "limit": 1}, headers=h).json()
                    for ev in msgs.get("chunk", []):
                        d = to_date(ev.get("origin_server_ts"))
                        if d and (not last or d > last):
                            last = d
                except Exception:
                    pass
            people[uid] = last
        limit = int(cfg.get("rooms") or 0)
        groups = {}
        if limit:
            direct_rooms = {r for rs in direct.values() for r in rs}
            for rid in run.get(f"{hs}/_matrix/client/v3/joined_rooms", headers=h).json().get("joined_rooms", []):
                if rid in direct_rooms:
                    continue
                mem = run.get(f"{hs}/_matrix/client/v3/rooms/{quote(rid)}/joined_members", headers=h).json()
                users = mem.get("joined", {})
                if len(users) <= limit:
                    try:
                        rname = run.get(f"{hs}/_matrix/client/v3/rooms/{quote(rid)}/state/m.room.name", headers=h).json().get("name")
                    except Exception:
                        rname = None
                    for uid in users:
                        people.setdefault(uid, None)
                        if rname:
                            groups.setdefault(uid, []).append(rname)
        out = []
        for uid, last in people.items():
            if uid == me:
                continue
            name = None
            try:
                name = run.get(f"{hs}/_matrix/client/v3/profile/{quote(uid)}/displayname",
                               headers=h).json().get("displayname")
            except Exception:
                pass
            out.append(Contact(service_id=uid, handle=uid, name=name or uid.split(":")[0].lstrip("@"),
                               last_contact=last, groups=groups.get(uid, [])))
        return out


IMPORTER = Matrix()
