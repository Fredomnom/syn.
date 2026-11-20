"""Gemeinsame Helfer für Importer."""
import io
import json
import zipfile

from ..importe import Contact
from ..vcard import card_to_contact, parse


def vcards_to_contacts(text, with_uid=True):
    out = []
    for card in parse(text):
        c = card_to_contact(card)
        if not (c["name"] or c["phones"] or c["emails"]):
            continue
        fields = {}
        if c["org"]:
            fields["f_company"] = c["org"]
        if c["title"]:
            fields["f_position"] = c["title"]
        if c["addresses"]:
            fields["f_addr"] = c["addresses"][0][0]
        photo = c["photo"]
        out.append(Contact(service_id=c["uid"] if with_uid else None, name=c["name"] or c["nickname"],
                           phones=c["phones"], emails=c["emails"], birthday=c["birthday"],
                           avatar_bytes=photo if isinstance(photo, bytes) else None,
                           avatar_url=photo if isinstance(photo, str) else None, fields=fields))
    return out


def iter_files(files, suffixes=None):
    """Entpackt ZIPs und liefert (Name, Bytes) aller passenden Dateien."""
    for name, data in files:
        if name.lower().endswith(".zip") or data[:2] == b"PK":
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for n in z.namelist():
                    if n.endswith("/"):
                        continue
                    if suffixes is None or n.lower().endswith(tuple(suffixes)):
                        yield n, z.read(n)
        elif suffixes is None or name.lower().endswith(tuple(suffixes)):
            yield name, data


def load_json(data):
    return json.loads(data.decode("utf-8", "replace") if isinstance(data, bytes) else data)


def fix_mojibake(s):
    """Meta-Exporte (Instagram/Facebook) kodieren UTF-8 als Latin-1-Escapes."""
    if not isinstance(s, str):
        return s
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s
