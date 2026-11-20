"""Konten: Erststart, Login, Tokens, Einstellungen, Ersteinrichtung und Admin."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import auth, db, seed
from ..auth import Ctx, admin, current
from ..util import new_id, now

router = APIRouter(prefix="/api/v1", tags=["Konten"])


class Login(BaseModel):
    username: str
    password: str
    code: str | None = None  # Einmalcode oder Wiederherstellungscode, wenn 2FA an ist


class NewUser(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    is_admin: bool = False


def create_user(username, password, display_name=None, is_admin=False) -> str:
    username = username.strip().lower()
    if not username or len(password) < 8:
        raise HTTPException(400, "Benutzername fehlt oder Passwort kürzer als 8 Zeichen")
    if db.val("SELECT 1 FROM users WHERE username=?", username):
        raise HTTPException(409, "Benutzername vergeben")
    uid = new_id("u")
    with db.tx():
        db.insert("users", {"id": uid, "username": username, "display_name": display_name or username,
                            "pw_hash": auth.hash_pw(password), "is_admin": int(is_admin), "created_at": now(),
                            "settings": "{}"})
        seed.seed_user(uid, display_name or username)
    return uid


def public_user(u, settings=None):
    return {"id": u["id"], "username": u["username"], "display_name": u["display_name"], "two_factor": bool(u.get("totp_secret")),
            "is_admin": bool(u["is_admin"]), "created_at": u["created_at"],
            **({"settings": settings} if settings is not None else {})}


@router.get("/instance")
def instance():
    """Öffentlich: ob schon ein Konto existiert (für den Erststart)."""
    return {"name": "syn", "needs_setup": not db.val("SELECT 1 FROM users LIMIT 1")}


@router.post("/instance/setup")
def first_admin(body: NewUser, response: Response, request: Request):
    """Nur beim allerersten Start: legt den Admin an. Danach legt der Admin Konten an."""
    with db.tx():
        if db.val("SELECT 1 FROM users LIMIT 1"):
            raise HTTPException(403, "Schon eingerichtet")
        uid = create_user(body.username, body.password, body.display_name, True)
    tok = auth.create_session(uid, request.headers.get("user-agent", ""))
    _cookie(response, tok, request)
    return {"token": tok}


def _cookie(response: Response, tok, request: Request):
    response.set_cookie(auth.COOKIE, tok, httponly=True, samesite="strict",
                        secure=request.url.scheme == "https", max_age=60 * 60 * 24 * 30)


@router.post("/auth/login")
def login(body: Login, response: Response, request: Request):
    u = db.q1("SELECT * FROM users WHERE username=?", body.username.strip().lower())
    if not u or not auth.check_pw(body.password, u["pw_hash"]):
        raise HTTPException(401, "Benutzername oder Passwort falsch")
    if u.get("totp_secret"):
        if not body.code:
            return {"need_code": True}
        if not _check_second(u, body.code):
            raise HTTPException(401, "Code stimmt nicht")
    tok = auth.create_session(u["id"], request.headers.get("user-agent", ""))
    _cookie(response, tok, request)
    return {"token": tok, "user": public_user(u)}


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    tok = request.cookies.get(auth.COOKIE) or request.headers.get("authorization", "")[7:]
    if tok:
        auth.drop_session(tok)
    response.delete_cookie(auth.COOKIE)
    return {"ok": True}


@router.get("/me")
def me(ctx: Ctx = Depends(current)):
    from ..model import self_id
    from ..importe import registry
    return {**public_user(ctx.user, ctx.settings), "self_id": self_id(ctx.uid), "read_only": ctx.read_only,
            "via": ctx.via, "importers_available": sorted(registry().keys())}


class PwChange(BaseModel):
    old: str
    new: str


@router.post("/me/password")
def change_pw(body: PwChange, ctx: Ctx = Depends(current)):
    if not auth.check_pw(body.old, ctx.user["pw_hash"]):
        raise HTTPException(400, "Altes Passwort falsch")
    if len(body.new) < 8:
        raise HTTPException(400, "Mindestens 8 Zeichen")
    db.ex("UPDATE users SET pw_hash=? WHERE id=?", auth.hash_pw(body.new), ctx.uid)
    return {"ok": True}


@router.patch("/me/settings")
def patch_settings(body: dict, ctx: Ctx = Depends(current)):
    allowed = set(seed.DEFAULT_SETTINGS) | {"display_name"}
    bad = set(body) - allowed
    if bad:
        raise HTTPException(400, f"Unbekannte Einstellungen: {', '.join(sorted(bad))}")
    if "dup_sensitivity" in body and body["dup_sensitivity"] not in ("strong", "medium", "all"):
        raise HTTPException(400, "dup_sensitivity: strong, medium oder all")
    if "sync" in body:
        s = body["sync"]
        if s.get("mode") not in ("all", "rule", "none"):
            raise HTTPException(400, "sync.mode: all, rule oder none")
    cur = db.jl(db.val("SELECT settings FROM users WHERE id=?", ctx.uid), {}) or {}
    if "display_name" in body:
        db.ex("UPDATE users SET display_name=? WHERE id=?", body.pop("display_name"), ctx.uid)
    cur.update(body)
    db.ex("UPDATE users SET settings=? WHERE id=?", db.jd(cur), ctx.uid)
    return auth.user_settings(ctx.uid)


class Setup(BaseModel):
    use_levels: bool
    use_ist: bool
    sync: dict


@router.post("/me/setup")
def first_setup(body: Setup, ctx: Ctx = Depends(current)):
    """Ersteinrichtung: Level ja/nein, berechnetes „Ist“ ja/nein, wer aufs Handy kommt."""
    patch_settings({"use_levels": body.use_levels, "use_ist": body.use_ist, "sync": body.sync,
                    "setup_done": True}, ctx)
    if not body.use_levels:
        # Level-Bedingungen in den mitgelieferten Routinen entfernen
        for r in db.q("SELECT * FROM routines WHERE user_id=?", ctx.uid):
            conds = [c for c in db.jl(r["conditions"], []) if c.get("field") != "f_level"]
            db.ex("UPDATE routines SET conditions=? WHERE id=?", db.jd(conds), r["id"])
    return auth.user_settings(ctx.uid)


# ---------------------------------------------------------------- Long-lived Access Tokens

class NewToken(BaseModel):
    name: str
    read_only: bool = False


@router.get("/tokens")
def tokens(ctx: Ctx = Depends(current)):
    return db.q("SELECT id,name,prefix,read_only,created_at,last_used_at,revoked_at FROM api_tokens "
                "WHERE user_id=? ORDER BY created_at DESC", ctx.uid)


@router.post("/tokens")
def new_token(body: NewToken, ctx: Ctx = Depends(current)):
    if ctx.via == "token":
        raise HTTPException(403, "Tokens nur über die Web-App anlegen")
    tok, row = auth.create_api_token(ctx.uid, body.name, body.read_only)
    return {"token": tok, "id": row["id"], "name": row["name"], "read_only": bool(row["read_only"])}


@router.delete("/tokens/{tid}")
def revoke_token(tid: str, ctx: Ctx = Depends(current)):
    db.ex("UPDATE api_tokens SET revoked_at=? WHERE id=? AND user_id=?", now(), tid, ctx.uid)
    return {"ok": True}


@router.get("/sessions")
def sessions(ctx: Ctx = Depends(current)):
    return db.q("SELECT created_at, expires_at, agent FROM sessions WHERE user_id=? ORDER BY created_at DESC",
                ctx.uid)


# ---------------------------------------------------------------- Admin

@router.get("/admin/users")
def list_users(ctx: Ctx = Depends(admin)):
    out = []
    for u in db.q("SELECT * FROM users ORDER BY created_at"):
        n = db.val("SELECT COUNT(*) FROM entities WHERE user_id=?", u["id"])
        out.append({**public_user(u), "entities": n})
    return out


@router.post("/admin/users")
def admin_create(body: NewUser, ctx: Ctx = Depends(admin)):
    uid = create_user(body.username, body.password, body.display_name, body.is_admin)
    return public_user(db.q1("SELECT * FROM users WHERE id=?", uid))


class AdminPatch(BaseModel):
    password: str | None = None
    is_admin: bool | None = None
    display_name: str | None = None


@router.patch("/admin/users/{uid}")
def admin_patch(uid: str, body: AdminPatch, ctx: Ctx = Depends(admin)):
    u = db.q1("SELECT * FROM users WHERE id=?", uid)
    if not u:
        raise HTTPException(404, "Konto nicht gefunden")
    if body.password:
        if len(body.password) < 8:
            raise HTTPException(400, "Mindestens 8 Zeichen")
        db.ex("UPDATE users SET pw_hash=? WHERE id=?", auth.hash_pw(body.password), uid)
        db.ex("DELETE FROM sessions WHERE user_id=?", uid)
    if body.is_admin is not None:
        if uid == ctx.uid and not body.is_admin:
            raise HTTPException(400, "Du kannst dir die Admin-Rechte nicht selbst nehmen")
        db.ex("UPDATE users SET is_admin=? WHERE id=?", int(body.is_admin), uid)
    if body.display_name:
        db.ex("UPDATE users SET display_name=? WHERE id=?", body.display_name, uid)
    return public_user(db.q1("SELECT * FROM users WHERE id=?", uid))


@router.delete("/admin/users/{uid}")
def admin_delete(uid: str, ctx: Ctx = Depends(admin)):
    if uid == ctx.uid:
        raise HTTPException(400, "Eigenes Konto kann nicht gelöscht werden")
    with db.tx():
        for t in ("entities", "field_defs", "field_values", "history", "circle_kinds", "bund_kinds", "circles",
                  "memberships", "bunds", "routines", "today_items", "contact_signals", "importer_configs",
                  "suggestions", "dup_marks", "notes", "saved_views", "files", "google_map", "api_tokens", "import_blocks",
                  "sessions"):
            db.ex(f"DELETE FROM {t} WHERE user_id=?", uid)
        db.ex("DELETE FROM users WHERE id=?", uid)
    return {"ok": True}


@router.get("/admin/importers")
def admin_importers(ctx: Ctx = Depends(admin)):
    from ..importe import all_importers, globally_disabled
    off = globally_disabled()
    return [{"id": i.id, "name": i.name, "enabled": i.id not in off} for i in all_importers().values()]


@router.put("/admin/importers/{iid}")
def admin_toggle_importer(iid: str, body: dict, ctx: Ctx = Depends(admin)):
    from ..importe import globally_disabled
    off = set(globally_disabled())
    if body.get("enabled"):
        off.discard(iid)
    else:
        off.add(iid)
    db.ex("INSERT OR REPLACE INTO instance(key,value) VALUES('disabled_importers',?)", db.jd(sorted(off)))
    return {"ok": True}


# ---------------------------------------------------------------- Zwei-Faktor (TOTP)
from .. import crypto, totp  # noqa: E402

_FAILS: dict = {}


def _check_second(u, code) -> bool:
    """Einmalcode aus der App oder einer der Wiederherstellungscodes (die gelten nur einmal)."""
    import time as _t
    fails = [x for x in _FAILS.get(u["id"], []) if _t.time() - x < 300]
    if len(fails) >= 8:
        raise HTTPException(429, "Zu viele Versuche – warte ein paar Minuten")
    secret = crypto.unseal(u["id"], u["totp_secret"])
    step = totp.verify(secret, code)
    if step is not None and step != u.get("totp_last"):
        db.ex("UPDATE users SET totp_last=? WHERE id=?", step, u["id"])
        return True
    codes = db.jl(u.get("totp_recovery"), []) or []
    hc = totp.hash_code(code)
    if hc in codes:
        codes.remove(hc)
        db.ex("UPDATE users SET totp_recovery=? WHERE id=?", db.jd(codes), u["id"])
        return True
    _FAILS[u["id"]] = fails + [_t.time()]
    return False


@router.get("/me/2fa")
def twofa_state(ctx: Ctx = Depends(current)):
    u = db.q1("SELECT totp_secret, totp_recovery FROM users WHERE id=?", ctx.uid)
    return {"enabled": bool(u["totp_secret"]), "recovery_left": len(db.jl(u["totp_recovery"], []) or [])}


@router.post("/me/2fa/setup")
def twofa_setup(ctx: Ctx = Depends(current)):
    """Neues Geheimnis erzeugen. Erst nach /enable mit einem gültigen Code ist 2FA an."""
    s = totp.new_secret()
    db.ex("UPDATE users SET totp_pending=? WHERE id=?", crypto.seal(ctx.uid, s), ctx.uid)
    return {"secret": s, "uri": totp.uri(s, ctx.user["username"])}


@router.post("/me/2fa/enable")
def twofa_enable(body: dict, ctx: Ctx = Depends(current)):
    u = db.q1("SELECT totp_pending FROM users WHERE id=?", ctx.uid)
    s = crypto.unseal(ctx.uid, u["totp_pending"]) if u["totp_pending"] else None
    if not s or totp.verify(s, body.get("code")) is None:
        raise HTTPException(400, "Code stimmt nicht – prüfe die Uhrzeit am Handy")
    codes = totp.recovery_codes()
    db.ex("UPDATE users SET totp_secret=?, totp_pending=NULL, totp_recovery=?, totp_last=NULL WHERE id=?",
          crypto.seal(ctx.uid, s), db.jd([totp.hash_code(c) for c in codes]), ctx.uid)
    return {"enabled": True, "recovery_codes": codes}


@router.post("/me/2fa/recovery")
def twofa_new_recovery(body: dict, ctx: Ctx = Depends(current)):
    """Neue Wiederherstellungscodes (die alten verfallen). Braucht einen aktuellen Code."""
    u = db.q1("SELECT * FROM users WHERE id=?", ctx.uid)
    if not u["totp_secret"] or not _check_second(u, body.get("code")):
        raise HTTPException(400, "Code stimmt nicht")
    codes = totp.recovery_codes()
    db.ex("UPDATE users SET totp_recovery=? WHERE id=?", db.jd([totp.hash_code(c) for c in codes]), ctx.uid)
    return {"recovery_codes": codes}


@router.post("/me/2fa/disable")
def twofa_disable(body: dict, ctx: Ctx = Depends(current)):
    u = db.q1("SELECT * FROM users WHERE id=?", ctx.uid)
    if not auth.check_pw(body.get("password") or "", u["pw_hash"]):
        raise HTTPException(400, "Passwort falsch")
    if u["totp_secret"] and not _check_second(u, body.get("code")):
        raise HTTPException(400, "Code stimmt nicht")
    db.ex("UPDATE users SET totp_secret=NULL, totp_pending=NULL, totp_recovery=NULL, totp_last=NULL WHERE id=?", ctx.uid)
    return {"enabled": False}
