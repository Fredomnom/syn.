"""Hilfsfunktionen: Zeit, IDs, Telefonnummern, ungenaue Datumsangaben, Namensvergleich."""
import re
import secrets
import unicodedata
from datetime import date, datetime, timedelta, timezone

_ALPH = "abcdefghijkmnpqrstuvwxyz23456789"


def new_id(prefix: str, n: int = 8) -> str:
    return f"{prefix}_" + "".join(secrets.choice(_ALPH) for _ in range(n))


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def today() -> str:
    return local_now().date().isoformat()


def local_now() -> datetime:
    return datetime.now().astimezone()


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


# ---------------------------------------------------------------- Telefon / E-Mail

def normalize_phone(raw: str, country: str = "49") -> str:
    """Vereinheitlicht eine Nummer nach E.164 (ohne Gewähr für exotische Formate)."""
    if not raw:
        return ""
    s = str(raw).strip()
    s = re.sub(r"\(0\)", "", s)
    plus = s.startswith("+")
    digits = re.sub(r"\D", "", s)
    if not digits:
        return ""
    if plus:
        return "+" + digits
    if digits.startswith("00"):
        return "+" + digits[2:]
    if digits.startswith("0"):
        return f"+{country}" + digits[1:]
    if len(digits) > 10:
        return "+" + digits
    return digits


def normalize_email(raw: str) -> str:
    return (raw or "").strip().lower()


# ---------------------------------------------------------------- ungenaue Daten

SEASONS = {"frühling": "Frühling", "fruehling": "Frühling", "sommer": "Sommer", "herbst": "Herbst",
           "winter": "Winter"}
SEASON_MONTH = {"Frühling": 4, "Sommer": 7, "Herbst": 10, "Winter": 1}
MONTHS = {"januar": 1, "jan": 1, "februar": 2, "feb": 2, "märz": 3, "maerz": 3, "mär": 3, "april": 4, "apr": 4,
          "mai": 5, "juni": 6, "jun": 6, "juli": 7, "jul": 7, "august": 8, "aug": 8, "september": 9, "sep": 9,
          "sept": 9, "oktober": 10, "okt": 10, "november": 11, "nov": 11, "dezember": 12, "dez": 12}


def parse_date(s):
    """Liest Datumsangaben, bei denen Jahr, Monat oder Tag fehlen dürfen.

    Gibt einen kanonischen String zurück: 'YYYY-MM-DD' mit '????'/'??' für fehlende Teile,
    oder 'YYYY-Herbst' / '????-Herbst' für Jahreszeiten. None, wenn nicht lesbar.
    """
    if s is None:
        return None
    if isinstance(s, (date, datetime)):
        return s.isoformat()[:10]
    t = str(s).strip()
    if not t:
        return None
    low = t.lower()
    if low in ("heute", "today"):
        return today()
    if low in ("gestern",):
        return (local_now().date() - timedelta(days=1)).isoformat()
    m = re.fullmatch(r"(\d{4}|\?{4})-(\d{2}|\?{2})-(\d{2}|\?{2})", t)
    if m:
        y, mo, d = m.groups()
        return _canon(y, mo, d)
    m = re.fullmatch(r"(\d{4}|\?{4})-(\d{1,2}|\?{2})", t)
    if m:
        return _canon(m.group(1), m.group(2), "??")
    m = re.fullmatch(r"(\d{4})", t)
    if m:
        return _canon(m.group(1), "??", "??")
    m = re.fullmatch(r"--(\d{2})-?(\d{2})", t)  # vCard ohne Jahr
    if m:
        return _canon("????", m.group(1), m.group(2))
    m = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?", t)
    if m:
        d, mo, y = m.groups()
        if y and len(y) == 2:
            y = ("20" if int(y) <= (date.today().year % 100) else "19") + y
        return _canon(y or "????", mo, d)
    m = re.fullmatch(r"(\d{1,2})/(\d{4})", t)
    if m:
        return _canon(m.group(2), m.group(1), "??")
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", t)
    if m:
        return _canon(*m.groups())
    parts = re.split(r"[\s-]+", low)
    season = next((SEASONS[p] for p in parts if p in SEASONS), None)
    year = next((p for p in parts if re.fullmatch(r"\d{4}", p)), None)
    month = next((MONTHS[p.rstrip(".")] for p in parts if p.rstrip(".") in MONTHS), None)
    day = next((p.rstrip(".") for p in parts if re.fullmatch(r"\d{1,2}\.?", p)), None)
    if season and len(parts) <= 2:
        return f"{year or '????'}-{season}"
    if month:
        return _canon(year or "????", str(month), day or "??")
    return None


def _canon(y, mo, d):
    y = y if y and y != "????" else "????"
    mo = f"{int(mo):02d}" if mo and mo != "??" else "??"
    d = f"{int(d):02d}" if d and d != "??" else "??"
    if mo != "??" and not 1 <= int(mo) <= 12:
        return None
    if d != "??" and not 1 <= int(d) <= 31:
        return None
    if y != "????" and mo != "??" and d != "??":
        try:
            date(int(y), int(mo), int(d))
        except ValueError:
            if not (mo == "02" and d == "29"):
                return None
    return f"{y}-{mo}-{d}"


def date_parts(s):
    """-> (jahr|None, monat|None, tag|None, jahreszeit|None)"""
    if not s or not isinstance(s, str):
        return (None, None, None, None)
    m = re.fullmatch(r"(\d{4}|\?{4})-(Frühling|Sommer|Herbst|Winter)", s)
    if m:
        y = None if m.group(1) == "????" else int(m.group(1))
        return (y, SEASON_MONTH[m.group(2)], None, m.group(2))
    m = re.fullmatch(r"(\d{4}|\?{4})-(\d{2}|\?{2})-(\d{2}|\?{2})", s)
    if not m:
        return (None, None, None, None)
    y, mo, d = m.groups()
    return (None if "?" in y else int(y), None if "?" in mo else int(mo), None if "?" in d else int(d), None)


def is_exact(s) -> bool:
    y, m, d, season = date_parts(s)
    return bool(y and m and d and not season)


def approx_date(s):
    """Ungefähres echtes Datum zum Rechnen (fehlender Tag = 1., fehlender Monat = Januar)."""
    y, m, d, _ = date_parts(s)
    if y is None:
        return None
    try:
        return date(y, m or 1, d or 1)
    except ValueError:
        return date(y, m or 1, 28)


def days_since(s):
    d = approx_date(s)
    if d is None:
        return None
    return (local_now().date() - d).days


def age_on(birth: str, on: date):
    y, m, d, _ = date_parts(birth)
    if not y or not m or not d:
        return None
    return on.year - y - ((on.month, on.day) < (m, d))


# ---------------------------------------------------------------- Namen

def fold(s: str) -> str:
    s = (s or "").lower().strip()
    s = s.replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", s)).strip()


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


_NICK_GROUPS = [
    "maximilian max maxi", "alexander alex alexandra sascha", "andreas andi", "christian chris christoph",
    "christina chrissi christine tina", "daniel dani danny", "elisabeth lisa elisa liz lissy betty", "florian flo",
    "johannes johann hannes jo jonas", "katharina kathi katrin kati kathrin", "michael micha michi mike",
    "nikolaus niklas nico nick klaus", "sebastian basti", "stefan steffen steffi stephanie", "tobias tobi",
    "thomas tom tommy", "matthias matze matt mathias", "benjamin ben benni", "william will bill",
    "robert rob bob robin", "richard rick ricky", "jennifer jenny jenni", "susanne susi sanne",
    "franziska franzi", "theresa resi tessa", "philipp phil pip", "dominik dom domi", "patrick paddy pat",
    "jacqueline jacky", "kai kay", "noah noa", "mia maria marie", "clara klara", "heinrich heinz",
    "wolfgang wolf", "gabriele gabi", "margarete grete greta", "valentin vali", "leonard leo leon",
    "konstantin konsti", "friedrich fritz", "josef sepp joe", "emanuel manu emmanuel", "samuel sam samantha",
    "victoria vicky viktoria", "rebecca becky", "anna anni annika", "lukas luke luca", "benedikt bene",
]
NICKNAMES = {}
for g in _NICK_GROUPS:
    names = g.split()
    for n in names:
        NICKNAMES.setdefault(n, set()).update(x for x in names if x != n)


def nick_match(a: str, b: str) -> bool:
    a, b = fold(a), fold(b)
    return a != b and b in NICKNAMES.get(a, ())


def first_name(name: str) -> str:
    n = (name or "").strip().rstrip("?").strip()
    return fold(n.split()[0]) if n.split() else ""
