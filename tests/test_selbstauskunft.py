"""Pflege-Link: Person prüft eigene Daten, Änderungen kommen nur als Vorschläge."""


def test_pflege_link_ablauf(client):
    c = client
    e = c.post("/api/v1/entities", json={"name": "Lena Bergg"}).json()
    eid = e["id"]
    c.put(f"/api/v1/entities/{eid}/fields/f_phone", json={"values": [{"value": "+49 151 1111111", "label": "privat"}]})
    c.put(f"/api/v1/entities/{eid}/fields/f_email", json={"values": [{"value": "alt@example.org"}]})
    c.put(f"/api/v1/entities/{eid}/fields/f_note", json={"values": [{"value": "Geheime Notiz über Lena"}]})
    c.put(f"/api/v1/entities/{eid}/fields/f_level", json={"values": [{"value": 4}]})

    l = c.post(f"/api/v1/entities/{eid}/update-link", json={}).json()
    assert l["active"] and l["path"].startswith("/u/") and "f_phone" in l["fields"]
    token = l["path"][3:]
    auth = c.headers.pop("Authorization")                          # die Person hat kein Konto
    pub = c.get(f"/api/v1/public/update/{token}").json()
    ids = [f["id"] for f in pub["fields"]]
    assert "f_note" not in ids and "f_level" not in ids              # nichts Privates
    assert "Geheime Notiz" not in str(pub) and "Ring" not in str(pub)
    phone = next(f for f in pub["fields"] if f["id"] == "f_phone")
    alt = phone["values"][0]["value"]
    assert alt.replace(" ", "").endswith("1511111111")

    r = c.post(f"/api/v1/public/update/{token}", json={
        "name": "Lena Berg",
        "fields": {
            "f_phone": [{"old": alt, "value": "+49 160 2222222", "comment": "neue Nummer seit dem Umzug"}],
            "f_email": [{"old": "alt@example.org", "value": None}, {"old": None, "value": "neu@example.org"}],
            "f_note": [{"old": None, "value": "eingeschmuggelt"}],             # nicht freigegeben → ignoriert
        },
        "message": "Hab alles aktualisiert!"}).json()
    assert r["ok"] and r["suggestions"] == 4
    c.headers["Authorization"] = auth

    # nichts wurde direkt geändert
    cur = c.get(f"/api/v1/entities/{eid}").json()
    assert cur["name"] == "Lena Bergg" and cur["fields"]["f_phone"][0]["value"] == alt
    assert cur["fields"]["f_note"][0]["value"] == "Geheime Notiz über Lena"
    sugg = c.get("/api/v1/suggestions", params={"entity_id": eid}).json()
    assert len(sugg) == 4 and all(s["source"] == "selbst" for s in sugg)
    ph = next(s for s in sugg if s["payload"].get("field") == "f_phone")
    assert ph["payload"]["comment"] == "neue Nummer seit dem Umzug" and "Umzug" in ph["payload"]["why"]
    # alles übernehmen
    for s in sugg:
        assert c.post(f"/api/v1/suggestions/{s['id']}/accept").status_code == 200
    cur = c.get(f"/api/v1/entities/{eid}").json()
    assert cur["name"] == "Lena Berg"
    assert [v["value"].replace(" ", "")[-10:] for v in cur["fields"]["f_phone"]] == ["1602222222"]
    mails = {v["value"]: v["deprecated"] for v in cur["fields"]["f_email"]}
    assert mails == {"alt@example.org": True, "neu@example.org": False}   # alte bleibt, als veraltet
    assert any("Angaben geprüft" in it["title"] for it in c.get("/api/v1/today").json()["items"])

    # Widerrufen → Link tot; neuer Link macht alten ungültig
    c.delete(f"/api/v1/update-links/{l['id']}")
    assert c.get(f"/api/v1/public/update/{token}").status_code == 404
    l2 = c.post(f"/api/v1/entities/{eid}/update-link", json={}).json()
    l3 = c.post(f"/api/v1/entities/{eid}/update-link", json={}).json()
    assert c.get(f"/api/v1/public/update/{l2['path'][3:]}").status_code == 404
    assert c.get(f"/api/v1/public/update/{l3['path'][3:]}").status_code == 200
    # abgelaufen
    from syn import db
    db.ex("UPDATE update_links SET expires_at='2000-01-01T00:00:00Z' WHERE id=?", l3["id"])
    assert c.get(f"/api/v1/public/update/{l3['path'][3:]}").status_code == 404
    assert c.post("/api/v1/entities/" + c.get("/api/v1/me").json()["self_id"] + "/update-link", json={}).status_code == 400


JPG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00fake"
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="


def test_freundebuch(client, monkeypatch):
    import httpx
    c = client
    e = c.post("/api/v1/entities", json={"name": "Mia Buch"}).json()
    l = c.post(f"/api/v1/entities/{e['id']}/update-link", json={}).json()
    assert l["freundebuch"]
    token = l["path"][3:]
    auth = c.headers.pop("Authorization")
    pub = c.get(f"/api/v1/public/update/{token}").json()
    qids = [q["id"] for q in pub["book"]["questions"]]
    assert "f_fb_like" in qids and "f_fb_photo" not in qids and pub["book"]["photo"] is True and pub["book"]["immich"] is False
    # ohne Immich: Foto liegt in syn wie andere Bild-Felder; nur echte Bilder (Dateianfang wird geprüft)
    assert c.post(f"/api/v1/public/update/{token}/photo", files={"file": ("a.jpg", b"kein bild", "image/jpeg")}).status_code == 400
    assert c.post(f"/api/v1/public/update/{token}/photo", files={"file": ("a.jpg", JPG, "image/jpeg")}, data={"as_avatar": "1"}).status_code == 200
    r = c.post(f"/api/v1/public/update/{token}", json={"book": {"f_fb_food": "Sushi", "f_fb_like": "Du hörst zu.", "f_note": "nicht erlaubt"},
                                                    "signature": PNG, "fields": {"f_phone": [{"old": None, "value": "+49 170 1234567"}]}}).json()
    assert r["book"] == 3 and r["suggestions"] == 1
    c.headers["Authorization"] = auth
    f = c.get(f"/api/v1/entities/{e['id']}").json()["fields"]
    assert f["f_fb_food"][0]["value"] == "Sushi" and f["f_fb_food"][0]["source"] == "selbst"   # direkt gespeichert
    assert f["f_fb_sign"][0]["value"].startswith("/api/v1/files/") and "f_note" not in f
    assert "f_phone" not in f                                                                  # Kontaktdaten: nur Vorschlag
    local = f["f_fb_photo"][0]["value"]
    assert local.startswith("/api/v1/files/") and c.get(local).content == JPG
    av = next(x for x in c.get("/api/v1/suggestions", params={"entity_id": e["id"]}).json() if x["kind"] == "avatar")
    assert c.post(f"/api/v1/suggestions/{av['id']}/accept").status_code == 200
    assert c.get(f"/api/v1/entities/{e['id']}").json()["avatar"] == local
    assert any("Freundebuch" in it["title"] for it in c.get("/api/v1/today").json()["items"])

    # mit Immich: Foto geht direkt dorthin (nachgebaut), landet im Album und ist über syn abrufbar
    c.put("/api/v1/importers/immich", json={"config": {"url": "http://immich.local:2283", "api_key": "k"}, "enabled": True})
    calls = []
    def post(url, **kw):
        calls.append(("POST", url.rsplit("/api/", 1)[1], kw.get("json")))
        return httpx.Response(201, json={"id": "fb-asset-1", "status": "created"}, request=httpx.Request("POST", url))
    def get(url, **kw):
        calls.append(("GET", url.rsplit("/api/", 1)[1], None))
        if url.endswith("/api/albums"):
            return httpx.Response(200, json=[], request=httpx.Request("GET", url))
        return httpx.Response(200, content=b"\xff\xd8jpg", headers={"content-type": "image/jpeg"}, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx, "post", post); monkeypatch.setattr(httpx, "get", get)
    from syn.modules import immich_api
    monkeypatch.setattr(immich_api, "_client", type("C", (), {"get": staticmethod(get)})())
    auth = c.headers.pop("Authorization")
    assert c.get(f"/api/v1/public/update/{token}").json()["book"]["photo"] is True
    assert c.post(f"/api/v1/public/update/{token}/photo", files={"file": ("a.txt", b"x", "text/plain")}).status_code == 400
    assert c.post(f"/api/v1/public/update/{token}/photo", files={"file": ("ich.jpg", JPG, "image/jpeg")}).status_code == 200
    c.headers["Authorization"] = auth
    assert ("POST", "assets", None) in calls and any(x[1] == "albums" and x[0] == "POST" and x[2]["albumName"] == "syn Freundebuch" for x in calls)
    photo = c.get(f"/api/v1/entities/{e['id']}").json()["fields"]["f_fb_photo"][0]["value"]
    assert photo == "/api/v1/immich/assets/fb-asset-1?size=preview"
    assert c.get(photo).status_code == 200


def test_profilbild_vorschlagen(client, monkeypatch):
    import httpx
    c = client
    e = c.post("/api/v1/entities", json={"name": "Ole Bild"}).json()
    c.put("/api/v1/importers/immich", json={"config": {"url": "http://immich.local:2283", "api_key": "k"}, "enabled": True})
    token = c.post(f"/api/v1/entities/{e['id']}/update-link", json={}).json()["path"][3:]
    resp = lambda m, url, **kw: httpx.Response(201 if m == "POST" else 200, request=httpx.Request(m, url), **kw)  # noqa: E731
    monkeypatch.setattr(httpx, "post", lambda url, **kw: resp("POST", url, json={"id": "av-1"}))
    monkeypatch.setattr(httpx, "get", lambda url, **kw: resp("GET", url, json=[]))
    from syn.modules import immich_api
    monkeypatch.setattr(immich_api, "_client", type("C", (), {"get": staticmethod(lambda url, **kw: resp("GET", url, content=b"\xff\xd8bild", headers={"content-type": "image/jpeg"}))})())
    auth = c.headers.pop("Authorization")
    assert c.post(f"/api/v1/public/update/{token}/photo", files={"file": ("ich.jpg", JPG, "image/jpeg")}, data={"as_avatar": "1"}).status_code == 200
    c.headers["Authorization"] = auth
    assert not c.get(f"/api/v1/entities/{e['id']}").json()["avatar"]                 # nicht direkt
    s = next(x for x in c.get("/api/v1/suggestions", params={"entity_id": e["id"]}).json() if x["kind"] == "avatar")
    assert s["payload"]["img"].startswith("/api/v1/immich/assets/av-1")
    assert c.post(f"/api/v1/suggestions/{s['id']}/accept").status_code == 200
    av = c.get(f"/api/v1/entities/{e['id']}").json()["avatar"]
    assert av.startswith("/api/v1/files/") and c.get(av).content == b"\xff\xd8bild"   # echte Datei in syn
