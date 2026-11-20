from ..importe import Contact, Importer


class Google(Importer):
    id = "google"
    steps = [
        'Verbinde zuerst Google unter Einstellungen → Handy & Sync → „Mit Google verbinden“.',
        'Schalte danach diesen Import ein.',
        'Klick auf „Importieren“.',
    ]
    name = "Google Kontakte"
    way = "People API mit OAuth"
    official = "ja"
    brings = "Namen, Nummern, Mails, Geburtstage, Fotos"
    needs = "google"
    service = None

    def fetch(self, cfg, run):
        from ..modules.google_sync import access_token
        tok = access_token(run.ctx)
        out, page = [], None
        fields = "names,phoneNumbers,emailAddresses,birthdays,photos,organizations,addresses,metadata,biographies"
        while True:
            params = {"personFields": fields, "pageSize": 1000}
            if page:
                params["pageToken"] = page
            r = run.get("https://people.googleapis.com/v1/people/me/connections", params=params,
                        headers={"Authorization": f"Bearer {tok}"}).json()
            for p in r.get("connections", []):
                out.append(person_to_contact(p))
            page = r.get("nextPageToken")
            if not page:
                break
        return out


def person_to_contact(p):
    name = (p.get("names") or [{}])[0].get("displayName")
    bday = None
    for b in p.get("birthdays", []):
        d = b.get("date")
        if d and d.get("month") and d.get("day"):
            y = d.get("year")
            bday = f"{y:04d}-{d['month']:02d}-{d['day']:02d}" if y else f"????-{d['month']:02d}-{d['day']:02d}"
            break
    lab = {"mobile": "mobil", "home": "privat", "work": "Arbeit"}
    photo = next((ph["url"] for ph in p.get("photos", []) if not ph.get("default")), None)
    org = (p.get("organizations") or [{}])[0]
    addr = (p.get("addresses") or [{}])[0].get("formattedValue")
    return Contact(service_id=p.get("resourceName"), name=name,
                   phones=[(x["value"], lab.get(x.get("type"))) for x in p.get("phoneNumbers", []) if x.get("value")],
                   emails=[(x["value"], lab.get(x.get("type"))) for x in p.get("emailAddresses", [])
                           if x.get("value")],
                   birthday=bday, avatar_url=photo,
                   fields={"f_company": org.get("name"), "f_position": org.get("title"), "f_addr": addr},
                   note=(p.get("biographies") or [{}])[0].get("value"))


IMPORTER = Google()
