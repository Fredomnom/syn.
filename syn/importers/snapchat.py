from ..importe import Contact, Importer
from ._common import iter_files, load_json


class Snapchat(Importer):
    id = "snapchat"
    name = "Snapchat"
    way = "Datenexport (JSON)"
    official = "Export ja"
    brings = "Freunde mit Datum"
    service = "snapchat"
    accepts_files = True
    file_hint = "accounts.snapchat.com → Meine Daten → Export mit JSON → ZIP hochladen (friends.json)"

    def fetch(self, cfg, run):
        out = []
        for name, data in iter_files(run.files, ["friends.json"]):
            j = load_json(data)
            for f in j.get("Friends", []):
                u = f.get("Username")
                if not u:
                    continue
                since = (f.get("Creation Timestamp") or "")[:10] or None
                out.append(Contact(service_id=u, handle=u, name=f.get("Display Name") or u, friend_since=since))
        return out


IMPORTER = Snapchat()
