"""Konten, Login-Tokens (kurzlebig) und Long-lived Access Tokens."""
import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request

from . import config, db
from .util import new_id, now

COOKIE = "syn_session"


def hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(h).decode()


def check_pw(pw: str, stored: str) -> bool:
    try:
        _, s, h = stored.split("$")
        calc = hashlib.scrypt(pw.encode(), salt=base64.b64decode(s), n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(h))
    except Exception:
        return False


def _sha(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def _exp(hours=None):
    return (datetime.now(timezone.utc) + timedelta(hours=hours or config.SESSION_HOURS)).isoformat()


def create_session(user_id: str, agent: str = "") -> str:
    tok = "ses_" + secrets.token_urlsafe(32)
    db.insert("sessions", {"id": _sha(tok), "user_id": user_id, "expires_at": _exp(), "created_at": now(),
                           "agent": (agent or "")[:200]})
    return tok


def drop_session(tok: str):
    db.ex("DELETE FROM sessions WHERE id=?", _sha(tok))


def create_api_token(user_id: str, name: str, read_only: bool) -> tuple[str, dict]:
    tok = "syn_" + secrets.token_urlsafe(32)
    row = {"id": new_id("tok"), "user_id": user_id, "name": name or "Token", "token_hash": _sha(tok),
           "prefix": tok[:8], "read_only": int(bool(read_only)), "created_at": now()}
    db.insert("api_tokens", row)
    return tok, row


@dataclass
class Ctx:
    user: dict
    read_only: bool = False
    via: str = "session"
    settings: dict = field(default_factory=dict)

    @property
    def uid(self) -> str:
        return self.user["id"]


def user_settings(uid: str) -> dict:
    from .seed import DEFAULT_SETTINGS
    row = db.q1("SELECT settings FROM users WHERE id=?", uid)
    s = dict(DEFAULT_SETTINGS)
    s.update(db.jl(row["settings"] if row else None, {}) or {})
    return s


def resolve_token(tok: str):
    """-> (user, read_only, via) oder None"""
    if not tok:
        return None
    h = _sha(tok)
    if tok.startswith("ses_"):
        s = db.q1("SELECT * FROM sessions WHERE id=?", h)
        if not s:
            return None
        exp = datetime.fromisoformat(s["expires_at"])
        if exp < datetime.now(timezone.utc):
            db.ex("DELETE FROM sessions WHERE id=?", h)
            return None
        if exp - datetime.now(timezone.utc) < timedelta(hours=config.SESSION_HOURS / 2):
            db.ex("UPDATE sessions SET expires_at=? WHERE id=?", _exp(), h)
        u = db.q1("SELECT * FROM users WHERE id=?", s["user_id"])
        return (u, False, "session") if u else None
    t = db.q1("SELECT * FROM api_tokens WHERE token_hash=? AND revoked_at IS NULL", h)
    if not t:
        return None
    db.ex("UPDATE api_tokens SET last_used_at=? WHERE id=?", now(), t["id"])
    u = db.q1("SELECT * FROM users WHERE id=?", t["user_id"])
    return (u, bool(t["read_only"]), "token") if u else None


def ctx_for(user: dict, read_only=False, via="internal") -> Ctx:
    return Ctx(user=user, read_only=read_only, via=via, settings=user_settings(user["id"]))


def current(request: Request) -> Ctx:
    """FastAPI-Abhängigkeit: Bearer-Token (Session oder Long-lived) oder Session-Cookie."""
    tok, via_cookie = None, False
    h = request.headers.get("authorization", "")
    if h.lower().startswith("bearer "):
        tok = h[7:].strip()
    elif request.cookies.get(COOKIE):
        tok, via_cookie = request.cookies.get(COOKIE), True
    res = resolve_token(tok)
    if not res:
        raise HTTPException(401, "Nicht angemeldet")
    user, ro, via = res
    if via_cookie and request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-syn") != "1":
        raise HTTPException(403, "Fehlender X-Syn-Header")
    if ro and request.method not in ("GET", "HEAD", "OPTIONS"):
        raise HTTPException(403, "Dieses Token darf nur lesen")
    return Ctx(user=user, read_only=ro, via=via, settings=user_settings(user["id"]))


def admin(request: Request) -> Ctx:
    c = current(request)
    if not c.user["is_admin"]:
        raise HTTPException(403, "Nur für Admins")
    return c


def basic_user(request: Request):
    """Für CardDAV: Basic-Auth mit Passwort oder Long-lived Token als Passwort."""
    h = request.headers.get("authorization", "")
    if h.lower().startswith("bearer "):
        res = resolve_token(h[7:].strip())
        return res[0] if res else None
    if not h.lower().startswith("basic "):
        return None
    try:
        user, _, pw = base64.b64decode(h[6:]).decode().partition(":")
    except Exception:
        return None
    u = db.q1("SELECT * FROM users WHERE username=?", user)
    if not u:
        return None
    if check_pw(pw, u["pw_hash"]):
        return u
    res = resolve_token(pw)
    if res and res[0]["id"] == u["id"]:
        return u
    return None
