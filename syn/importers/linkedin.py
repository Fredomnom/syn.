import csv
import io
from datetime import datetime

from ..importe import Contact, Importer
from ._common import iter_files


class LinkedIn(Importer):
    id = "linkedin"
    name = "LinkedIn"
    way = "Datenexport (Connections.csv)"
    official = "Export ja"
    brings = "Kontakte mit Firma, Position, Datum"
    service = "linkedin"
    accepts_files = True
    file_hint = "LinkedIn → Einstellungen → Datenschutz → Kopie deiner Daten → Kontakte (Connections.csv oder ZIP)"

    def fetch(self, cfg, run):
        out = []
        for name, data in iter_files(run.files, ["connections.csv"]):
            text = data.decode("utf-8-sig", "replace")
            lines = text.splitlines()
            start = next((i for i, ln in enumerate(lines) if ln.startswith("First Name")), 0)
            for r in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
                n = " ".join(x for x in (r.get("First Name"), r.get("Last Name")) if x).strip()
                if not n:
                    continue
                since = None
                try:
                    since = datetime.strptime(r.get("Connected On", ""), "%d %b %Y").date().isoformat()
                except ValueError:
                    pass
                url = r.get("URL") or ""
                out.append(Contact(service_id=url.rstrip("/").rsplit("/", 1)[-1] or n, handle=n, name=n, url=url,
                                   emails=[(r["Email Address"], "Arbeit")] if r.get("Email Address") else [],
                                   friend_since=since,
                                   fields={"f_company": r.get("Company"), "f_position": r.get("Position")}))
        return out


IMPORTER = LinkedIn()
