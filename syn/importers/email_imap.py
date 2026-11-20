import email.utils
import imaplib
import re
from datetime import date, timedelta
from email.header import decode_header, make_header

from ..importe import Contact, Importer

NOREPLY = re.compile(r"no-?reply|noreply|do-?not-?reply|mailer-daemon|notifications?@|newsletter|bounce", re.I)


def _dec(h):
    try:
        return str(make_header(decode_header(h or "")))
    except Exception:
        return h or ""


class Imap(Importer):
    id = "imap"
    steps = [
        'Such die IMAP-Daten deines Mail-Anbieters (Server, meist Port 993).',
        'Bei Gmail, iCloud oder Outlook brauchst du ein App-Passwort statt deines normalen Passworts.',
        'Trag Server, Benutzername und Passwort hier ein; Ordnernamen nur, wenn sie anders heißen.',
        'Wähl, ob neue Leute angelegt werden sollen, und klick auf „Importieren“.',
    ]
    name = "E-Mail"
    way = "IMAP"
    official = "ja, Standard"
    brings = "Korrespondenzpartner, letzte Mail"
    config = [
        {"key": "host", "label": "IMAP-Server", "type": "text", "required": True, "placeholder": "imap.example.org"},
        {"key": "port", "label": "Port", "type": "number", "placeholder": "993"},
        {"key": "username", "label": "Benutzername", "type": "text", "required": True},
        {"key": "password", "label": "Passwort / App-Passwort", "type": "secret", "required": True},
        {"key": "sent", "label": "Gesendet-Ordner", "type": "text", "placeholder": "Sent"},
        {"key": "inbox", "label": "Posteingang", "type": "text", "placeholder": "INBOX"},
        {"key": "days", "label": "Zeitraum (Tage)", "type": "number", "placeholder": "365"},
        {"key": "new_people", "label": "Neue Leute anlegen", "type": "select", "options": ["nein", "ja"],
         "help": "„nein“: nur bekannte Personen bekommen „letzte Mail“"},
    ]

    def _scan(self, M, folder, since, field_names):
        typ, _ = M.select(f'"{folder}"', readonly=True)
        if typ != "OK":
            return {}
        typ, data = M.search(None, "SINCE", since.strftime("%d-%b-%Y"))
        ids = data[0].split()[-3000:]
        found = {}
        for i in range(0, len(ids), 200):
            chunk = b",".join(ids[i:i + 200])
            typ, msgs = M.fetch(chunk, f"(BODY.PEEK[HEADER.FIELDS ({' '.join(field_names)} DATE)])")
            for m in msgs:
                if not isinstance(m, tuple):
                    continue
                msg = email.message_from_bytes(m[1])
                try:
                    d = email.utils.parsedate_to_datetime(msg.get("Date")).date().isoformat()
                except Exception:
                    continue
                for fn in field_names:
                    for name, addr in email.utils.getaddresses(msg.get_all(fn, [])):
                        addr = addr.lower().strip()
                        if not addr or NOREPLY.search(addr):
                            continue
                        cur = found.get(addr)
                        if not cur or cur[1] < d:
                            found[addr] = (_dec(name) or (cur[0] if cur else ""), d)
        return found

    def fetch(self, cfg, run):
        M = imaplib.IMAP4_SSL(cfg["host"], int(cfg.get("port") or 993))
        M.login(cfg["username"], cfg["password"])
        since = date.today() - timedelta(days=int(cfg.get("days") or 365))
        try:
            sent = self._scan(M, cfg.get("sent") or "Sent", since, ["TO", "CC"])
            inbox = self._scan(M, cfg.get("inbox") or "INBOX", since, ["FROM"])
        finally:
            M.logout()
        me = cfg["username"].lower()
        out = []
        new = cfg.get("new_people") == "ja"
        for addr in set(sent) | set(inbox):
            if addr == me:
                continue
            two_way = addr in sent and addr in inbox
            name = (inbox.get(addr) or sent.get(addr))[0]
            last = max(x[1] for x in (sent.get(addr), inbox.get(addr)) if x)
            out.append(Contact(name=name or None, emails=[(addr, None)], last_contact=last,
                               only_existing=not (new and two_way)))
        run.log(f"{len(sent)} Empfänger, {len(inbox)} Absender")
        return out


IMPORTER = Imap()
