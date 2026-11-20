from ..importe import Contact, Importer, to_date
from ._common import fix_mojibake, iter_files, load_json


class Facebook(Importer):
    id = "facebook"
    steps = [
        'Facebook → Einstellungen → „Deine Informationen herunterladen“.',
        'Wähl nur „Freunde und Follower“, Format JSON.',
        'Lade die ZIP herunter, sobald sie fertig ist.',
        'Wähl sie hier aus und klick auf „Importieren“.',
    ]
    name = "Facebook"
    way = "Datenexport (JSON)"
    official = "Export ja"
    brings = "Freunde mit Datum"
    service = "facebook"
    accepts_files = True
    file_hint = "Facebook → Einstellungen → Deine Informationen herunterladen → Freunde, Format JSON"

    def fetch(self, cfg, run):
        out = []
        for name, data in iter_files(run.files, [".json"]):
            low = name.lower()
            if "friend" not in low or "removed" in low or "rejected" in low or "sent" in low or "received" in low:
                continue
            j = load_json(data)
            lst = j if isinstance(j, list) else next((v for k, v in j.items() if isinstance(v, list)), [])
            for f in lst:
                n = fix_mojibake(f.get("name"))
                if n:
                    out.append(Contact(service_id=n, handle=n, name=n, friend_since=to_date(f.get("timestamp"))))
            run.log(f"{name}: {len(lst)}")
        return out


IMPORTER = Facebook()
