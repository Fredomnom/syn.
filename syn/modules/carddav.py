"""syn als CardDAV-Server: das Handy synchronisiert direkt mit syn (iPhone: CardDAV-Konto, Android: DAVx⁵).

Aufs Handy geht nur, was ein Telefonbuch versteht: Name, Nummern, E-Mails, Geburtstag, Profilbild, dazu ein Link
zur Personenseite. Ein neuer Kontakt vom Handy landet unter „Lose“. Löschen am Handy schaltet nur „aufs Handy“ aus.

URLs:  /.well-known/carddav  →  /dav/  →  /dav/<benutzer>/  →  /dav/<benutzer>/kontakte/<id>.vcf
Login: Benutzername + Passwort oder ein Long-lived Token als Passwort.
"""
import hashlib
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape as xesc

from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse

from .. import auth, db, model, sync_rules, vcard
from ..util import normalize_email, normalize_phone, now

router = APIRouter(tags=["CardDAV"], include_in_schema=False)
DAV_METHODS = ["OPTIONS", "PROPFIND", "REPORT", "GET", "HEAD", "PUT", "DELETE"]
NS = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:carddav", "cs": "http://calendarserver.org/ns/"}
BOOK = "kontakte"


def _unauth():
    return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="syn"'})


def _ms(responses: list[str]) -> Response:
    body = ('<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" '
            'xmlns:c="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/">'
            + "".join(responses) + "</d:multistatus>")
    return Response(body, status_code=207, media_type="application/xml; charset=utf-8")


def _resp(href, props: dict, missing=()):
    ok = "".join(f"<{k}>{v}</{k.split(' ')[0]}>" if v is not None else f"<{k}/>" for k, v in props.items())
    out = f"<d:response><d:href>{xesc(href)}</d:href><d:propstat><d:prop>{ok}</d:prop>" \
          f"<d:status>HTTP/1.1 200 OK</d:status></d:propstat>"
    if missing:
        nf = "".join(f"<{m}/>" for m in missing)
        out += f"<d:propstat><d:prop>{nf}</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>"
    return out + "</d:response>"


def _requested(body: bytes):
    if not body:
        return None
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return None
    prop = root.find("d:prop", NS)
    if prop is None:
        return None
    out = []
    for el in prop:
        ns, _, tag = el.tag[1:].partition("}")
        pre = {"DAV:": "d", "urn:ietf:params:xml:ns:carddav": "c", "http://calendarserver.org/ns/": "cs"}.get(ns)
        out.append(f"{pre}:{tag}" if pre else tag)
    return out


# ---------------------------------------------------------------- Karten

def card_for(ctx, row) -> str:
    uid = ctx.uid
    vals = model.get_values("entity", row["id"], include_deprecated=False)
    phones = [(v["value"], v["label"], v["primary"]) for v in vals.get("f_phone", [])]
    emails = [(v["value"], v["label"], v["primary"]) for v in vals.get("f_email", [])]
    bday = model.primary(vals.get("f_bday"))
    photo, mime = None, None
    if row["avatar"] and row["avatar"].startswith("/api/v1/files/"):
        from .dateien import read_bytes
        photo, mime = read_bytes(uid, row["avatar"].rsplit("/", 1)[1])
    host = (ctx.settings.get("public_host") or "").rstrip("/")
    if host and not host.startswith("http"):
        host = "https://" + host
    name = (row["name"] or row["description"] or "Ohne Namen") + (" ?" if row["name_uncertain"] and row["name"] else "")
    return vcard.build(row["id"], name, phones, emails, bday["value"] if bday else None, photo, mime,
                       url=f"{host}/#/p/{row['id']}" if host else None, rev=row["updated_at"],
                       n=(row.get("last_name"), row.get("first_name"), row.get("middle_names")) if row.get("name") else None)


def etag(card: str) -> str:
    return '"' + hashlib.sha1(card.encode()).hexdigest()[:20] + '"'


def _book(ctx):
    rows = sync_rules.synced_rows(ctx)
    cards = {r["id"]: card_for(ctx, r) for r in rows}
    return rows, cards


def _browser_list(ctx) -> Response:
    """Im Browser geöffnet: zeigen, was das Handy bekommt (Handys selbst fragen per PROPFIND/REPORT)."""
    rows = sync_rules.synced_rows(ctx)
    u = xesc(ctx.user["username"])
    items = "".join(f'<li><a href="/dav/{u}/{BOOK}/{xesc(r["id"])}.vcf">{xesc(r["name"] or r["description"] or "Ohne Namen")}</a></li>'
                    for r in sorted(rows, key=lambda r: (r["name"] or r["description"] or "").lower()))
    body = (f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            f'<title>syn CardDAV</title><body style="font:15px/1.5 system-ui;max-width:720px;margin:32px auto;padding:0 16px">'
            f'<h1>syn CardDAV</h1><p>Das ist die Adresse für dein Handy, kein Ort zum Lesen. Ins Handy gehört '
            f'<code>/dav/</code> als Server, Benutzer <code>{u}</code>, als Passwort am besten ein Token.</p>'
            f'<p><b>{len(rows)} Kontakte</b> gehen aufs Handy (Adressbuch <code>/dav/{u}/{BOOK}/</code>):</p><ol>{items}</ol>')
    return Response(body, media_type="text/html; charset=utf-8")


def ctag(cards: dict) -> str:
    h = hashlib.sha1()
    for k in sorted(cards):
        h.update(k.encode() + etag(cards[k]).encode())
    return h.hexdigest()[:24]


# ---------------------------------------------------------------- Routen

@router.get("/.well-known/carddav")
@router.api_route("/.well-known/carddav", methods=["PROPFIND"])
def well_known():
    return RedirectResponse("/dav/", status_code=301)


@router.api_route("/dav/", methods=DAV_METHODS)
@router.api_route("/dav", methods=DAV_METHODS)
async def root(request: Request):
    user = auth.basic_user(request)
    if not user:
        return _unauth()
    if request.method == "OPTIONS":
        return _options()
    if request.method in ("GET", "HEAD"):
        return _browser_list(auth.ctx_for(user))
    home = f"/dav/{user['username']}/"
    return _ms([_resp("/dav/", {"d:current-user-principal": f"<d:href>{home}</d:href>",
                                "c:addressbook-home-set": f"<d:href>{home}</d:href>",
                                "d:resourcetype": "<d:collection/>"})])


def _options():
    return Response(headers={"DAV": "1, 3, addressbook", "Allow": ", ".join(DAV_METHODS)})


@router.api_route("/dav/{username}/", methods=DAV_METHODS)
@router.api_route("/dav/{username}", methods=DAV_METHODS)
async def home(username: str, request: Request):
    user = auth.basic_user(request)
    if not user or user["username"] != username:
        return _unauth()
    if request.method == "OPTIONS":
        return _options()
    ctx = auth.ctx_for(user)
    if request.method in ("GET", "HEAD"):
        return _browser_list(ctx)
    h = f"/dav/{username}/"
    out = [_resp(h, {"d:resourcetype": "<d:collection/><d:principal/>", "d:displayname": xesc(user["display_name"]),
                     "d:current-user-principal": f"<d:href>{h}</d:href>",
                     "c:addressbook-home-set": f"<d:href>{h}</d:href>"})]
    if request.headers.get("depth", "0") != "0":
        out.append(_book_props(ctx, h + BOOK + "/"))
    return _ms(out)


def _book_props(ctx, href):
    rows, cards = _book(ctx)
    return _resp(href, {
        "d:resourcetype": "<d:collection/><c:addressbook/>", "d:displayname": "syn",
        "cs:getctag": ctag(cards),
        "d:current-user-principal": f"<d:href>/dav/{xesc(ctx.user['username'])}/</d:href>",
        "d:supported-report-set": "<d:supported-report><d:report><c:addressbook-multiget/></d:report>"
                                  "</d:supported-report><d:supported-report><d:report><c:addressbook-query/>"
                                  "</d:report></d:supported-report>",
        "d:current-user-privilege-set": "<d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege>",
        "c:supported-address-data": '<c:address-data-type content-type="text/vcard" version="3.0"/>',
    })


@router.api_route("/dav/{username}/" + BOOK + "/", methods=DAV_METHODS)
@router.api_route("/dav/{username}/" + BOOK, methods=DAV_METHODS)
async def book(username: str, request: Request):
    user = auth.basic_user(request)
    if not user or user["username"] != username:
        return _unauth()
    if request.method == "OPTIONS":
        return _options()
    ctx = auth.ctx_for(user)
    base = f"/dav/{username}/{BOOK}/"
    body = await request.body()
    if request.method == "PROPFIND":
        out = [_book_props(ctx, base)]
        if request.headers.get("depth", "0") != "0":
            _, cards = _book(ctx)
            for eid, card in cards.items():
                out.append(_resp(f"{base}{eid}.vcf", {"d:getetag": xesc(etag(card)),
                                                      "d:getcontenttype": "text/vcard; charset=utf-8",
                                                      "d:resourcetype": None}))
        return _ms(out)
    if request.method == "REPORT":
        _, cards = _book(ctx)
        want = None
        try:
            root_el = ET.fromstring(body)
            if root_el.tag.endswith("addressbook-multiget"):
                want = [h.text.rstrip("/").rsplit("/", 1)[-1].removesuffix(".vcf")
                        for h in root_el.findall("d:href", NS) if h.text]
        except ET.ParseError:
            pass
        out = []
        for eid in (want if want is not None else cards.keys()):
            card = cards.get(eid)
            if card is None:
                out.append(f"<d:response><d:href>{base}{eid}.vcf</d:href>"
                           "<d:status>HTTP/1.1 404 Not Found</d:status></d:response>")
                continue
            out.append(_resp(f"{base}{eid}.vcf", {"d:getetag": xesc(etag(card)),
                                                  "c:address-data": xesc(card)}))
        return _ms(out)
    if request.method in ("GET", "HEAD"):
        return _browser_list(ctx)
    return Response(status_code=405)


@router.api_route("/dav/{username}/" + BOOK + "/{name}", methods=DAV_METHODS)
async def card(username: str, name: str, request: Request):
    user = auth.basic_user(request)
    if not user or user["username"] != username:
        return _unauth()
    ctx = auth.ctx_for(user)
    eid = name.removesuffix(".vcf")
    rows = {r["id"]: r for r in model.load_rows(ctx, ids=[eid])}
    row = rows.get(eid)
    if request.method == "OPTIONS":
        return _options()
    if request.method in ("GET", "HEAD", "PROPFIND"):
        if not row or not sync_rules.synced(ctx, row):
            return Response(status_code=404)
        c = card_for(ctx, row)
        if request.method == "PROPFIND":
            return _ms([_resp(f"/dav/{username}/{BOOK}/{name}", {"d:getetag": xesc(etag(c)),
                                                                  "d:getcontenttype": "text/vcard; charset=utf-8"})])
        return Response(c if request.method == "GET" else b"", media_type="text/vcard; charset=utf-8",
                        headers={"ETag": etag(c)})
    if request.method == "DELETE":
        if row:
            # Löschen am Handy entfernt nur vom Handy, nichts in syn
            model.patch_entity(ctx.uid, eid, {"on_phone": False}, "Handy (CardDAV)")
        return Response(status_code=204)
    if request.method == "PUT":
        body = (await request.body()).decode("utf-8", "replace")
        cards = vcard.parse(body)
        if not cards:
            return Response(status_code=400)
        c = vcard.card_to_contact(cards[0])
        created = False
        if not row:
            target = eid if eid.startswith("p_") and db.val("SELECT 1 FROM entities WHERE id=? AND user_id=?", eid,
                                                            ctx.uid) else None
            if not target:
                target = model.create_entity(ctx.uid, name=c["name"] or "Vom Handy", source="Handy (CardDAV)")
                created = True
            model.patch_entity(ctx.uid, target, {"on_phone": True}, "Handy (CardDAV)")
            eid = target
        apply_phone_card(ctx, eid, c, "Handy (CardDAV)")
        row = model.load_rows(ctx, ids=[eid])[0]
        newcard = card_for(ctx, row)
        loc = f"/dav/{username}/{BOOK}/{eid}.vcf"
        return Response(status_code=201 if created else 204, headers={"ETag": etag(newcard), "Location": loc})
    return Response(status_code=405)


def apply_phone_card(ctx, eid, c, source):
    """Änderungen vom Handy: nur Telefonbuch-Felder, der Name nur wenn er sich wirklich geändert hat."""
    uid = ctx.uid
    defs = model.field_defs(uid)
    country = ctx.settings.get("country_code", "49")
    e = model.get_entity(uid, eid)
    name = (c["name"] or "").rstrip(" ?").strip()
    if name and name != (e["name"] or e["description"]):
        model.patch_entity(uid, eid, {"name": name}, source)
    for fid, items, norm in (("f_phone", c["phones"], lambda x: normalize_phone(x, country)),
                             ("f_email", c["emails"], normalize_email)):
        if fid not in defs:
            continue
        cur = model.get_values("entity", eid).get(fid, [])
        have = {norm(v["value"]) for v in cur}
        incoming = {norm(v): (v, lab) for v, lab in items}
        new = list(cur)
        # vom Handy gelöschte Nummern werden als veraltet markiert statt gelöscht
        for v in new:
            if not v["deprecated"] and norm(v["value"]) not in incoming:
                v["deprecated"] = True
        for k, (v, lab) in incoming.items():
            if k not in have:
                new.append({"value": v, "label": lab, "source": source, "primary": not new})
            else:
                for x in new:
                    if norm(x["value"]) == k:
                        x["deprecated"] = False
        if new != cur:
            model.set_values(uid, "entity", eid, defs[fid], new, source)
    if c["birthday"] and "f_bday" in defs:
        cur = model.primary(model.get_values("entity", eid).get("f_bday"))
        if not cur or cur["value"] != c["birthday"]:
            model.set_entity_field(uid, eid, "f_bday", c["birthday"], source)
    if isinstance(c["photo"], bytes) and not e["avatar"]:
        from .dateien import store_bytes
        fid = store_bytes(uid, c["photo"], "image/jpeg")
        model.patch_entity(uid, eid, {"avatar": f"/api/v1/files/{fid}"}, source)
    db.ex("UPDATE entities SET updated_at=? WHERE id=?", now(), eid)


# ---------------------------------------------------------------- Einrichtung per QR-Code
# Die Web-App legt ein eigenes Token fürs Handy an. Android (DAVx⁵) bekommt es direkt im Link,
# das iPhone über ein Konfigurationsprofil, das 15 Minuten lang unter einem Einmal-Link abrufbar ist.
import plistlib  # noqa: E402
import secrets  # noqa: E402
import time  # noqa: E402
import uuid  # noqa: E402

from fastapi import Depends, HTTPException  # noqa: E402

from ..auth import Ctx, current  # noqa: E402

_SETUP: dict[str, tuple[float, str, str]] = {}  # Code → (gültig bis, Benutzername, Token)
SETUP_TTL = 15 * 60


@router.post("/api/v1/carddav/setup", include_in_schema=False)
def carddav_setup(ctx: Ctx = Depends(current)):
    if ctx.via == "token" or ctx.read_only:
        raise HTTPException(403, "Nur über die Web-App")
    tok, row = auth.create_api_token(ctx.uid, "Handy (CardDAV per QR)", False)
    t = time.time()
    for k, (exp, *_rest) in list(_SETUP.items()):
        if exp < t:
            _SETUP.pop(k, None)
    code = secrets.token_urlsafe(18)
    _SETUP[code] = (t + SETUP_TTL, ctx.user["username"], tok)
    return {"username": ctx.user["username"], "token": tok, "token_id": row["id"],
            "profile_path": f"/carddav-setup/{code}.mobileconfig", "expires_in": SETUP_TTL}


@router.get("/carddav-setup/{code}.mobileconfig", include_in_schema=False)
def carddav_profile(code: str, request: Request):
    hit = _SETUP.get(code)
    if not hit or hit[0] < time.time():
        _SETUP.pop(code, None)
        return Response("Der Link ist abgelaufen. Erzeuge in syn unter Einstellungen → Handy & Sync einen neuen QR-Code.",
                        status_code=410, media_type="text/plain; charset=utf-8")
    _, username, tok = hit
    url = request.url
    https = url.scheme == "https"
    port = url.port or (443 if https else 80)
    ident = "syn.carddav." + (url.hostname or "local")
    account = {
        "PayloadType": "com.apple.carddav.account", "PayloadVersion": 1,
        "PayloadIdentifier": ident + ".account", "PayloadUUID": str(uuid.uuid4()),
        "PayloadDisplayName": "syn Kontakte", "CardDAVAccountDescription": f"syn ({url.hostname})",
        "CardDAVHostName": url.hostname, "CardDAVPort": port, "CardDAVUseSSL": https,
        "CardDAVPrincipalURL": "/dav/", "CardDAVUsername": username, "CardDAVPassword": tok,
    }
    profile = {
        "PayloadType": "Configuration", "PayloadVersion": 1, "PayloadIdentifier": ident,
        "PayloadUUID": str(uuid.uuid4()), "PayloadDisplayName": "syn – Kontakte",
        "PayloadDescription": "Synchronisiert deine Kontakte aus syn mit diesem iPhone.",
        "PayloadOrganization": "syn", "PayloadContent": [account],
    }
    return Response(plistlib.dumps(profile), media_type="application/x-apple-aspen-config",
                    headers={"Content-Disposition": 'attachment; filename="syn-kontakte.mobileconfig"',
                             "Cache-Control": "no-store"})
