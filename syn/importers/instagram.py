import re

from ..importe import Contact, Importer, to_date
from ._common import fix_mojibake, iter_files, load_json


def _entries(obj):
    """Alle string_list_data-Einträge eines Instagram-Exports, egal wie verschachtelt."""
    if isinstance(obj, dict):
        if "string_list_data" in obj:
            for s in obj["string_list_data"]:
                yield {"user": s.get("value") or obj.get("title"), "href": s.get("href"),
                       "ts": s.get("timestamp")}
        else:
            for v in obj.values():
                yield from _entries(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _entries(v)


class Instagram(Importer):
    id = "instagram"
    steps = [
        'Öffne Instagram → Einstellungen → Kontenübersicht → „Deine Informationen herunterladen“.',
        'Wähl „Einige deiner Informationen“: Follower und Gefolgte, Nachrichten.',
        'Format: JSON. Zeitraum: Gesamter Zeitraum. Anfordern.',
        'Lade die ZIP-Datei aus der Mail herunter.',
        'Wähl die ZIP hier aus und klick auf „Importieren“.',
    ]
    name = "Instagram"
    way = "Datenexport (JSON)"
    official = "Export ja"
    brings = "Follower, Gefolgte, DMs"
    service = "instagram"
    accepts_files = True
    file_hint = "Instagram → Kontenübersicht → Deine Informationen herunterladen → Format JSON → ZIP hochladen"

    def fetch(self, cfg, run):
        people = {}

        def p(user):
            return people.setdefault(user.lower(), {"user": user, "rel": set(), "since": None, "last": None,
                                                    "name": None})

        for name, data in iter_files(run.files, [".json"]):
            low = name.lower()
            if "followers" in low or "following" in low:
                rel = "follower" if "followers" in low else "following"
                for e in _entries(load_json(data)):
                    if not e["user"]:
                        continue
                    x = p(e["user"])
                    x["rel"].add(rel)
                    d = to_date(e["ts"])
                    if d and (not x["since"] or d < x["since"]):
                        x["since"] = d
            elif "/inbox/" in low and re.search(r"message_\d+\.json$", low):
                thread = low.split("/inbox/")[1].split("/")[0]
                handle = thread.rsplit("_", 1)[0]
                j = load_json(data)
                parts = [fix_mojibake(x.get("name")) for x in j.get("participants", [])]
                if len(parts) != 2 or not handle:
                    continue
                ts = max((m.get("timestamp_ms", 0) for m in j.get("messages", [])), default=0)
                x = p(handle)
                x["rel"].add("dm")
                x["last"] = max(filter(None, [x["last"], to_date(ts)]), default=None)
                x["name"] = x["name"] or parts[1]
        out = []
        for key, x in people.items():
            mutual = {"follower", "following"} <= x["rel"]
            out.append(Contact(service_id=None, handle=x["user"], name=x["name"] or x["user"],
                               url=f"https://instagram.com/{x['user']}",
                               friend_since=x["since"] if mutual else None, last_contact=x["last"]))
        run.log(f"{len(out)} Konten")
        return out


IMPORTER = Instagram()
