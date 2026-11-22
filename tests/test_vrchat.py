"""VRChat-Importer gegen eine nachgebaute API (kein Netz)."""
import httpx
import pytest

from syn.importers.vrchat import IMPORTER as VR


class FakeRun:
    def __init__(self, handler):
        self.http = httpx.Client(transport=httpx.MockTransport(handler))
        self.lines, self.job = [], {}

    def get(self, url, **kw):
        r = self.http.get(url, **kw)
        r.raise_for_status()
        return r

    def log(self, m):
        self.lines.append(m)

    def progress(self, **kw):
        self.job.update(kw)


def friends(n, start=0, prefix="usr_"):
    return [{"id": f"{prefix}{i}", "displayName": f"Freund {i}", "bio": "Hallo", "bioLinks": ["https://x.example/a"],
             "userIcon": "https://api.vrchat.cloud/api/1/file/file_1/1/file" if i % 2 else "https://cdn.example.org/p.png"}
            for i in range(start, start + n)]


def test_vrchat_liest_alle_freunde_mit_paging():
    calls = []

    def handler(req: httpx.Request):
        calls.append(req)
        assert "syn-contacts" in req.headers["user-agent"]
        assert "auth=authcookie_abc" in req.headers["cookie"] and "twoFactorAuth=tfa" in req.headers["cookie"]
        if req.url.path.endswith("/auth/user"):
            return httpx.Response(200, json={"displayName": "Fred", "friends": ["x"] * 150})
        if req.url.path.endswith("/userNotes"):
            return httpx.Response(200, json=[{"targetUserId": "usr_1", "note": "Kennt sich mit Avataren aus"}] if req.url.params["offset"] == "0" else [])
        off, offline = int(req.url.params["offset"]), req.url.params["offline"] == "true"
        if not offline:
            return httpx.Response(200, json=friends(100, off) if off == 0 else friends(20, 100))
        return httpx.Response(200, json=friends(30, 200) + friends(1, 0))  # einer doppelt → nur einmal

    out = VR.fetch({"auth": "auth=authcookie_abc", "twofactor": "tfa", "offline": "ja"}, FakeRun(handler))
    assert len(out) == 150
    c = out[1]
    assert c.service_id == "usr_1" and c.handle == "Freund 1" and c.url == "https://vrchat.com/home/user/usr_1"
    assert c.note.startswith("Kennt sich mit Avataren aus")           # deine Notiz zuerst
    assert "VRChat-Bio: Hallo" in c.note and "https://x.example/a" in c.note
    assert out[2].note.startswith("VRChat-Bio:")                         # ohne eigene Notiz nur die Bio
    assert "auth=" in c.avatar_headers["Cookie"]            # Bild bei VRChat: mit Cookie
    assert "Cookie" not in out[0].avatar_headers              # fremder Server: ohne Cookie
    assert c.last_contact is None


def test_vrchat_meldet_abgelaufenes_cookie_verstaendlich():
    run = FakeRun(lambda req: httpx.Response(401, json={"error": {"message": "Missing Credentials"}}))
    with pytest.raises(ValueError, match="abgelaufen"):
        VR.fetch({"auth": "x"}, run)


def test_vrchat_zwei_faktor_noetig():
    run = FakeRun(lambda req: httpx.Response(200, json={"requiresTwoFactorAuth": ["totp"]}))
    with pytest.raises(ValueError, match="twoFactorAuth"):
        VR.fetch({"auth": "x"}, run)


def test_vrchat_ist_registriert_und_dienst_vorhanden(client):
    imps = {i["id"]: i for i in client.get("/api/v1/importers").json()}
    assert "vrchat" in imps and imps["vrchat"]["unofficial"]
    svcs = {s["id"] for s in client.get("/api/v1/services").json()}
    assert "vrchat" in svcs


def test_notiz_aus_zweitem_dienst_wird_vorschlag(client, app):
    """Hat eine Person schon eine Notiz aus Dienst A, wird die Notiz aus Dienst B nicht verworfen, sondern vorgeschlagen."""
    from syn import auth, db
    from syn.importe import Contact, Run, all_importers, apply_contacts
    uid = db.val("SELECT id FROM users LIMIT 1")
    ctx = auth.ctx_for(db.q1("SELECT * FROM users WHERE id=?", uid))
    imps = all_importers()
    a, b = imps["discord"], imps["vrchat"]
    apply_contacts(ctx, a, [Contact(service_id="1", name="Ida Ost", note="aus Discord")], Run(ctx, a))
    eid = db.val("SELECT owner_id FROM field_values WHERE field_id='f_note'")
    prof = client.get(f"/api/v1/entities/{eid}").json()["fields"]["f_profile"]
    client.put(f"/api/v1/entities/{eid}/fields/f_profile", json={"values": prof + [{"value": {"service": "vrchat", "id": "usr_9", "handle": "Ida"}}]})
    apply_contacts(ctx, b, [Contact(service_id="usr_9", name="Ida Ost", note="aus VRChat")], Run(ctx, b))
    e = client.get(f"/api/v1/entities/{eid}").json()
    assert e["fields"]["f_note"][0]["value"] == "aus Discord"
    sugg = client.get("/api/v1/suggestions", params={"entity_id": eid}).json()
    assert any("aus VRChat" in str(s["payload"]["value"]) and "aus Discord" in str(s["payload"]["value"]) for s in sugg)


def test_mastodon_uebernimmt_private_notizen():
    from syn.importers.mastodon import IMPORTER as M

    def handler(req):
        p = req.url.path
        if p.endswith("verify_credentials"):
            return httpx.Response(200, json={"id": "1"})
        if p.endswith("/following") or p.endswith("/followers"):
            return httpx.Response(200, json=[{"id": "7", "acct": "ida", "username": "ida", "display_name": "Ida", "url": "u"}])
        if p.endswith("/relationships"):
            assert req.url.params.get_list("id[]") == ["7"]
            return httpx.Response(200, json=[{"id": "7", "note": "Trifft man auf jedem Barcamp"}])
        return httpx.Response(404)

    run = FakeRun(handler)
    out = M.fetch({"instance": "social.example", "token": "t"}, run)
    assert out[0].note == "Trifft man auf jedem Barcamp"
