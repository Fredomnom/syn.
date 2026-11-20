"""Zwei-Faktor-Anmeldung mit Einmalcodes (TOTP, RFC 6238) – passt zu jeder Authenticator-App."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    d = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = d[-1] & 15
    return f"{(struct.unpack('>I', d[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def now_code(secret: str, at: float | None = None) -> str:
    return _code(secret, int((at or time.time()) // 30))


def verify(secret: str, code: str, window: int = 1) -> int | None:
    """Gibt den Zeitschritt zurück, wenn der Code passt (±30 s Spielraum), sonst None."""
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(code) != 6 or not secret:
        return None
    step = int(time.time() // 30)
    for w in range(-window, window + 1):
        if hmac.compare_digest(_code(secret, step + w), code):
            return step + w
    return None


def uri(secret: str, account: str, issuer: str = "syn") -> str:
    return f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}&issuer={quote(issuer)}&digits=6&period=30"


def recovery_codes(n: int = 10) -> list[str]:
    return ["-".join(secrets.token_hex(2) for _ in range(3)) for _ in range(n)]


def hash_code(c: str) -> str:
    return hashlib.sha256(c.strip().lower().replace(" ", "").encode()).hexdigest()
