from datetime import date, timedelta
from xml.etree import ElementTree as ET

from ..importe import Contact, Importer

REPORT = """<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
<c:time-range start="{start}" end="{end}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>"""


def parse_ics(text):
    lines = []
    for ln in text.replace("\r\n", "\n").split("\n"):
        if ln[:1] in (" ", "\t") and lines:
            lines[-1] += ln[1:]
        else:
            lines.append(ln)
    ev, out = None, []
    for ln in lines:
        if ln == "BEGIN:VEVENT":
            ev = {"attendees": []}
        elif ln == "END:VEVENT" and ev is not None:
            out.append(ev)
            ev = None
        elif ev is not None and ":" in ln:
            head, val = ln.split(":", 1) if not ln.startswith(("ATTENDEE", "ORGANIZER")) else _split(ln)
            name = head.split(";")[0]
            if name == "DTSTART":
                ev["date"] = f"{val[0:4]}-{val[4:6]}-{val[6:8]}"
            elif name in ("ATTENDEE", "ORGANIZER"):
                cn = None
                for p in head.split(";")[1:]:
                    if p.upper().startswith("CN="):
                        cn = p[3:].strip('"')
                if val.lower().startswith("mailto:"):
                    ev["attendees"].append((cn, val[7:].lower()))
    return out


def _split(ln):
    q = False
    for i, ch in enumerate(ln):
        if ch == '"':
            q = not q
        elif ch == ":" and not q:
            return ln[:i], ln[i + 1:]
    return ln, ""


class Kalender(Importer):
    id = "kalender"
    name = "Kalender"
    way = "CalDAV, ICS-Link oder Google Calendar API"
    official = "ja"
    brings = "Teilnehmer gemeinsamer Termine als „zuletzt gesehen“"
    config = [
        {"key": "ics", "label": "ICS-Links (einer pro Zeile)", "type": "textarea"},
        {"key": "caldav", "label": "CalDAV-Kalender-URL", "type": "text"},
        {"key": "username", "label": "CalDAV-Benutzer", "type": "text"},
        {"key": "password", "label": "CalDAV-Passwort", "type": "secret"},
        {"key": "google", "label": "Google Calendar (Google-Verbindung)", "type": "select",
         "options": ["nein", "ja"]},
        {"key": "me", "label": "Deine E-Mail-Adressen (kommagetrennt)", "type": "text"},
        {"key": "days", "label": "Zeitraum (Tage zurück)", "type": "number", "placeholder": "180"},
    ]

    def fetch(self, cfg, run):
        days = int(cfg.get("days") or 180)
        start, end = date.today() - timedelta(days=days), date.today()
        events = []
        for url in (cfg.get("ics") or "").split():
            events += parse_ics(run.get(url.replace("webcal://", "https://")).text)
        if cfg.get("caldav"):
            r = run.request("REPORT", cfg["caldav"], auth=(cfg.get("username", ""), cfg.get("password", "")),
                            headers={"Depth": "1", "Content-Type": "application/xml"},
                            content=REPORT.format(start=start.strftime("%Y%m%dT000000Z"),
                                                  end=end.strftime("%Y%m%dT235959Z")))
            for el in ET.fromstring(r.content).iter("{urn:ietf:params:xml:ns:caldav}calendar-data"):
                events += parse_ics(el.text or "")
        if cfg.get("google") == "ja":
            from ..modules.google_sync import access_token
            tok = access_token(run.ctx)
            page = None
            while True:
                params = {"timeMin": start.isoformat() + "T00:00:00Z", "timeMax": end.isoformat() + "T23:59:59Z",
                          "singleEvents": "true", "maxResults": 2500}
                if page:
                    params["pageToken"] = page
                r = run.get("https://www.googleapis.com/calendar/v3/calendars/primary/events", params=params,
                            headers={"Authorization": f"Bearer {tok}"}).json()
                for e in r.get("items", []):
                    d = (e.get("start", {}).get("date") or e.get("start", {}).get("dateTime") or "")[:10]
                    events.append({"date": d, "attendees": [(a.get("displayName"), a.get("email", "").lower())
                                                            for a in e.get("attendees", []) if not a.get("self")]})
                page = r.get("nextPageToken")
                if not page:
                    break
        me = {x.strip().lower() for x in (cfg.get("me") or "").split(",") if x.strip()}
        last = {}
        for ev in events:
            d = ev.get("date")
            if not d or d > end.isoformat() or d < start.isoformat():
                continue
            for cn, mail in ev["attendees"]:
                if mail in me or not mail:
                    continue
                if mail not in last or last[mail][1] < d:
                    last[mail] = (cn, d)
        run.log(f"{len(events)} Termine, {len(last)} Teilnehmer")
        return [Contact(name=cn, emails=[(mail, None)], seen=d, only_existing=True) for mail, (cn, d) in last.items()]


IMPORTER = Kalender()
