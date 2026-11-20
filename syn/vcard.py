"""vCard lesen (2.1, 3.0, 4.0) und schreiben (3.0, wird von iOS und DAVx⁵ verstanden)."""
import base64
import quopri
import re

from .util import date_parts, parse_date

LABELS_IN = {"cell": "mobil", "mobile": "mobil", "home": "privat", "work": "Arbeit", "voice": None, "pref": None,
             "internet": None, "main": "privat", "iphone": "mobil", "other": None, "x-uni": "Uni", "x-school": "Uni"}
LABELS_OUT = {"privat": "HOME", "Arbeit": "WORK", "mobil": "CELL", "Uni": "OTHER"}


def unescape(v: str) -> str:
    return re.sub(r"\\([nN,;\\:])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), v)


def escape(v: str) -> str:
    return str(v).replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def parse(text: str) -> list[dict]:
    """-> Liste von Karten: {PROPNAME: [(params, value), ...]}"""
    if isinstance(text, bytes):
        text = text.decode("utf-8", "replace")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for ln in text.split("\n"):
        if ln[:1] in (" ", "\t") and lines:
            lines[-1] += ln[1:]
        elif lines and lines[-1].upper().endswith("=") and "QUOTED-PRINTABLE" in lines[-1].upper():
            lines[-1] = lines[-1][:-1] + ln
        else:
            lines.append(ln)
    cards, cur = [], None
    for ln in lines:
        if not ln.strip():
            continue
        if ln.upper().startswith("BEGIN:VCARD"):
            cur = {}
            continue
        if ln.upper().startswith("END:VCARD"):
            if cur is not None:
                cards.append(cur)
            cur = None
            continue
        if cur is None or ":" not in ln:
            continue
        head, value = _split_head(ln)
        parts = head.split(";")
        name = parts[0].split(".")[-1].upper()
        params = {}
        for p in parts[1:]:
            if "=" in p:
                k, v = p.split("=", 1)
                params.setdefault(k.upper(), []).extend(x.strip('"').lower() for x in v.split(","))
            else:
                params.setdefault("TYPE", []).append(p.lower())
        if "QUOTED-PRINTABLE" in [x.upper() for x in params.get("ENCODING", [])]:
            value = quopri.decodestring(value.encode()).decode(
                (params.get("CHARSET") or ["utf-8"])[0], "replace")
        cur.setdefault(name, []).append((params, value))
    return cards


def _split_head(ln):
    # Doppelpunkt in Anführungszeichen (z.B. Parameter mit URL) überspringen
    q = False
    for i, ch in enumerate(ln):
        if ch == '"':
            q = not q
        elif ch == ":" and not q:
            return ln[:i], ln[i + 1:]
    return ln, ""


def first(card, name):
    v = card.get(name)
    return unescape(v[0][1]) if v else None


def label_of(params):
    for t in params.get("TYPE", []):
        lab = LABELS_IN.get(t, "" if t.startswith("x-") else None)
        if lab:
            return lab
    return None


def card_to_contact(card) -> dict:
    """Vereinfachte Sicht: name, phones, emails, birthday, photo, org, title, nickname, addresses, urls, uid."""
    name = first(card, "FN")
    if not name and card.get("N"):
        parts = [unescape(x) for x in card["N"][0][1].split(";")]
        name = " ".join(x for x in (parts[3] if len(parts) > 3 else "", parts[1] if len(parts) > 1 else "",
                                    parts[2] if len(parts) > 2 else "", parts[0]) if x).strip()
    phones = [(v.replace("tel:", "").strip(), label_of(p)) for p, v in card.get("TEL", []) if v.strip()]
    emails = [(v.strip(), label_of(p)) for p, v in card.get("EMAIL", []) if v.strip()]
    bday = None
    if card.get("BDAY"):
        p, v = card["BDAY"][0]
        v = v.strip()
        if "X-APPLE-OMIT-YEAR" in p and v[:4] == p["X-APPLE-OMIT-YEAR"][0][:4]:
            v = ("--" + v[5:7] + "-" + v[8:10]) if "-" in v else ("--" + v[4:6] + "-" + v[6:8])
        if v.startswith("--"):
            bday = parse_date(v[:7])
        elif len(v) >= 10 and v[4] == "-":
            bday = parse_date(v[:10])
        else:
            bday = parse_date(v[:8])
    photo = None
    if card.get("PHOTO"):
        p, v = card["PHOTO"][0]
        enc = [x.lower() for x in p.get("ENCODING", [])]
        if v.startswith("data:"):
            try:
                photo = base64.b64decode(v.split(",", 1)[1])
            except Exception:
                photo = None
        elif "b" in enc or "base64" in enc:
            try:
                photo = base64.b64decode(v)
            except Exception:
                photo = None
        elif v.startswith("http"):
            photo = v
    addrs = []
    for p, v in card.get("ADR", []):
        parts = [unescape(x) for x in v.split(";")]
        while len(parts) < 7:
            parts.append("")
        street, city, region, zipc, country = parts[2], parts[3], parts[4], parts[5], parts[6]
        txt = "\n".join(x for x in (street, " ".join(y for y in (zipc, city) if y), region, country) if x)
        if txt.strip():
            addrs.append((txt, label_of(p)))
    org = first(card, "ORG")
    return {"uid": first(card, "UID"), "name": name, "phones": phones, "emails": emails, "birthday": bday,
            "photo": photo, "org": org.split(";")[0] if org else None, "title": first(card, "TITLE"),
            "nickname": first(card, "NICKNAME"), "addresses": addrs, "note": first(card, "NOTE"),
            "urls": [v for _, v in card.get("URL", [])]}


def fold_line(line: str) -> str:
    """Zeilen nach RFC 6350 auf 75 Bytes falten (ohne UTF-8-Zeichen zu zerschneiden). Linear, auch für große Fotos."""
    b = line.encode()
    if len(b) <= 75:
        return line
    out, pos, limit = [], 0, 75
    while len(b) - pos > limit:
        cut = pos + limit
        while cut > pos and (b[cut] & 0xC0) == 0x80:
            cut -= 1
        out.append(b[pos:cut].decode())
        pos, limit = cut, 74  # Folgezeilen beginnen mit einem Leerzeichen
    out.append(b[pos:].decode())
    return "\r\n ".join(out)


def build(uid: str, name: str, phones, emails, birthday=None, photo: bytes | None = None, photo_mime="image/jpeg",
          url=None, rev=None, nickname=None, org=None, title=None, n=None) -> str:
    """phones/emails: [(Wert, Label, Hauptwert?)]; n: (Nachname, Vorname, weitere Vornamen)"""
    lines = ["BEGIN:VCARD", "VERSION:3.0", f"UID:{uid}", f"FN:{escape(name)}"]
    if n and (n[0] or n[1]):
        lines.append(f"N:{escape(n[0] or '')};{escape(n[1] or '')};{escape(n[2] or '')};;")
    else:
        parts = name.split()
        last = parts[-1] if len(parts) > 1 else ""
        given = " ".join(parts[:-1]) if len(parts) > 1 else name
        lines.append(f"N:{escape(last)};{escape(given)};;;")
    if nickname:
        lines.append(f"NICKNAME:{escape(nickname)}")
    if org:
        lines.append(f"ORG:{escape(org)}")
    if title:
        lines.append(f"TITLE:{escape(title)}")
    for v, label, pref in phones:
        t = LABELS_OUT.get(label or "", "CELL" if not label else "OTHER")
        lines.append(f"TEL;TYPE={t}{',PREF' if pref else ''}:{v}")
    for v, label, pref in emails:
        t = LABELS_OUT.get(label or "", "HOME")
        lines.append(f"EMAIL;TYPE=INTERNET,{t}{',PREF' if pref else ''}:{v}")
    if birthday:
        y, m, d, season = date_parts(birthday)
        if m and d and not season:
            if y:
                lines.append(f"BDAY:{y:04d}-{m:02d}-{d:02d}")
            else:
                lines.append(f"BDAY;X-APPLE-OMIT-YEAR=1604:1604-{m:02d}-{d:02d}")
    if url:
        lines.append(f"URL;TYPE=syn:{url}")
    if photo:
        t = "PNG" if "png" in (photo_mime or "") else "JPEG"
        lines.append(f"PHOTO;ENCODING=b;TYPE={t}:" + base64.b64encode(photo).decode())
    if rev:
        lines.append(f"REV:{rev}")
    lines.append("END:VCARD")
    return "\r\n".join(fold_line(x) for x in lines) + "\r\n"
