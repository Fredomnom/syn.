from xml.etree import ElementTree as ET

from ..importe import Contact, Importer, to_date
from ._common import iter_files


class Android(Importer):
    id = "android"
    name = "Android-Anrufe und SMS"
    way = "Backup-Export als XML (SMS Backup & Restore)"
    official = "Datei"
    brings = "Nummern, letzter Kontakt"
    accepts_files = True
    file_hint = "calls-….xml und sms-….xml aus „SMS Backup & Restore“"
    config = [{"key": "new_people", "label": "Neue Leute anlegen", "type": "select", "options": ["nein", "ja"],
               "help": "„nein“: nur bekannte Nummern bekommen „letzter Kontakt“"}]

    def fetch(self, cfg, run):
        last, names = {}, {}
        for name, data in iter_files(run.files, [".xml"]):
            root = ET.fromstring(data)
            for el in root:
                num = el.get("number") or el.get("address")
                if not num or el.tag not in ("call", "sms", "mms"):
                    continue
                if el.tag == "call" and el.get("duration") == "0":
                    continue
                d = to_date(el.get("date"))
                if d and (num not in last or last[num] < d):
                    last[num] = d
                cn = el.get("contact_name")
                if cn and cn != "(Unknown)":
                    names[num] = cn
            run.log(f"{name}: {len(last)} Nummern")
        new = cfg.get("new_people") == "ja"
        return [Contact(name=names.get(n), phones=[(n, "mobil")], last_contact=d, only_existing=not new)
                for n, d in last.items()]


IMPORTER = Android()
