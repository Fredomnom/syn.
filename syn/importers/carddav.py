import re
from urllib.parse import urljoin
from xml.etree import ElementTree as ET

from ..importe import Importer
from ._common import vcards_to_contacts

NS = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:carddav"}
PROPFIND = """<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
<d:prop><d:resourcetype/><d:displayname/><d:getetag/><d:current-user-principal/><c:addressbook-home-set/></d:prop>
</d:propfind>"""
QUERY = """<?xml version="1.0"?><c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
<d:prop><d:getetag/><c:address-data/></d:prop></c:addressbook-query>"""


class CardDAV(Importer):
    id = "carddav"
    name = "iCloud, Nextcloud, Radicale"
    way = "CardDAV"
    official = "ja, Standard"
    brings = "Namen, Nummern, Mails, Geburtstage, Fotos"
    config = [
        {"key": "url", "label": "Adressbuch-URL", "type": "text", "required": True,
         "help": "z.B. https://cloud.example.org/remote.php/dav/addressbooks/users/NAME/contacts/ – "
                 "iCloud: https://contacts.icloud.com (Adressbuch wird gesucht)"},
        {"key": "username", "label": "Benutzername", "type": "text", "required": True},
        {"key": "password", "label": "Passwort / App-Passwort", "type": "secret", "required": True},
    ]

    def _propfind(self, run, url, depth):
        r = run.request("PROPFIND", url, content=PROPFIND, headers={"Depth": str(depth),
                                                                     "Content-Type": "application/xml"})
        return ET.fromstring(r.content)

    def _find_books(self, run, url):
        """Folgt current-user-principal → addressbook-home-set → Adressbücher."""
        root = self._propfind(run, url, 0)
        for resp in root.findall("d:response", NS):
            if resp.find(".//d:resourcetype/c:addressbook", NS) is not None:
                return [url]
            p = resp.find(".//d:current-user-principal/d:href", NS)
            if p is not None and p.text:
                return self._find_books(run, urljoin(url, p.text)) if urljoin(url, p.text) != url else []
            h = resp.find(".//c:addressbook-home-set/d:href", NS)
            if h is not None and h.text:
                home = urljoin(url, h.text)
                books = []
                for r2 in self._propfind(run, home, 1).findall("d:response", NS):
                    if r2.find(".//d:resourcetype/c:addressbook", NS) is not None:
                        books.append(urljoin(home, r2.find("d:href", NS).text))
                return books
        return []

    def fetch(self, cfg, run):
        run.http.auth = (cfg.get("username", ""), cfg.get("password", ""))
        books = self._find_books(run, cfg["url"])
        if not books:
            raise RuntimeError("Kein Adressbuch gefunden")
        out = []
        for b in books:
            r = run.request("REPORT", b, content=QUERY, headers={"Depth": "1", "Content-Type": "application/xml"})
            root = ET.fromstring(r.content)
            n = 0
            for ad in root.iter("{urn:ietf:params:xml:ns:carddav}address-data"):
                if ad.text:
                    out += vcards_to_contacts(ad.text)
                    n += 1
            run.log(f"{b}: {n} Karten")
        return out


IMPORTER = CardDAV()
