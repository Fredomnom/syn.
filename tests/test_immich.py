"""Immich: Personen aus der Gesichtserkennung werden Personen in syn, ihre Fotos erscheinen auf der Personenseite."""
import httpx
import pytest

PEOPLE = [{"id": "imm-1", "name": "Lena Berg", "birthDate": "1994-03-02", "isHidden": False},
          {"id": "imm-2", "name": "", "isHidden": False},                     # unbenannt → Eintrag ohne Namen
          {"id": "imm-3", "name": "Versteckt", "isHidden": True}]             # versteckt → trotzdem, wie alle
ASSETS = {"imm-2": [{"id": "u1", "localDateTime": "2025-05-05T10:00:00"}], "imm-1": [{"id": f"a{i}", "localDateTime": f"2026-0{1 + i % 9}-1{i % 9}T10:00:00"} for i in range(260)]}
JPEG = b"\xff\xd8\xff\xe0fakejpeg"


def handler(req: httpx.Request):
    assert req.headers.get("x-api-key") == "geheim"
    p = req.url.path
    if p == "/api/people":
        return httpx.Response(200, json={"people": PEOPLE, "hasNextPage": False, "total": 3})
    if p == "/api/search/metadata":
        import json
        body = json.loads(req.content)
        items = ASSETS.get(body["personIds"][0], [])
        page, size = body["page"], body["size"]
        chunk = items[(page - 1) * size: page * size]
        nxt = str(page + 1) if page * size < len(items) else None
        return httpx.Response(200, json={"assets": {"items": chunk, "nextPage": nxt, "total": len(items)}, "albums": {}})
    if p.startswith("/api/people/") and p.endswith("/thumbnail"):
        return httpx.Response(200, content=JPEG, headers={"content-type": "image/jpeg"})
    if p.startswith("/api/assets/") and p.endswith("/thumbnail"):
        return httpx.Response(200, content=JPEG + req.url.params["size"].encode(), headers={"content-type": "image/jpeg"})
    return httpx.Response(404)


@pytest.fixture()
def immich(monkeypatch):
    real = httpx.Client
    monkeypatch.setattr("syn.importe.httpx.Client", lambda *a, **kw: real(transport=httpx.MockTransport(handler), **{k: v for k, v in kw.items() if k != "transport"}))
    from syn.modules import immich_api
    monkeypatch.setattr(immich_api, "_client", real(transport=httpx.MockTransport(handler)))


def test_immich_personen_und_fotos(client, immich):
    c = client
    r = c.put("/api/v1/importers/immich", json={"config": {"url": "http://immich.local:2283/", "api_key": "geheim"}, "enabled": True})
    assert r.status_code == 200, r.text
    from syn import auth, db
    from syn.importe import run_importer
    ctx = auth.ctx_for(db.q1("SELECT * FROM users LIMIT 1"))
    status = run_importer(ctx, "immich")
    assert "3 gelesen, 3 neu" in status, status
    alle = c.get("/api/v1/entities").json()
    ohne = next(x for x in alle if not x["name"] and x["description"] == "Person von Fotos (1 Foto)")
    assert c.get(f"/api/v1/entities/{ohne['id']}/photos").json()["total"] == 1
    assert any(x["name"] == "Versteckt" for x in alle)
    lena = next(x for x in c.get("/api/v1/entities").json() if x["name"] == "Lena Berg")
    e = c.get(f"/api/v1/entities/{lena['id']}").json()
    prof = e["fields"]["f_profile"][0]["value"]
    assert prof["service"] == "immich" and prof["id"] == "imm-1" and prof["url"] == "http://immich.local:2283/people/imm-1"
    assert e["fields"]["f_bday"][0]["value"] == "1994-03-02"
    assert e["avatar"]                                           # Gesichtsbild als Profilbild
    ph = c.get(f"/api/v1/entities/{lena['id']}/photos").json()
    assert ph["total"] == 260 and ph["immich"] == "http://immich.local:2283"
    assert ph["items"][0]["taken_at"] >= ph["items"][-1]["taken_at"]   # neueste zuerst
    rnd = c.get(f"/api/v1/entities/{lena['id']}/photos", params={"random_n": 8}).json()
    assert len(rnd["items"]) == 8
    img = c.get("/api/v1/immich/assets/a5", params={"size": "preview"})
    assert img.status_code == 200 and img.content.endswith(b"preview") and "private" in img.headers["cache-control"]
    # fremde oder unbekannte Fotos werden nicht durchgereicht
    assert c.get("/api/v1/immich/assets/fremd").status_code == 404
    assert c.get("/api/v1/immich/assets/a5", params={"size": "original"}).status_code == 400
    # Person ohne Immich-Profil: keine Fotos
    other = c.post("/api/v1/entities", json={"name": "Ohne Fotos"}).json()
    assert c.get(f"/api/v1/entities/{other['id']}/photos").json()["total"] == 0
    # Verbindung löschen entfernt die Verweise
    c.delete("/api/v1/importers/immich")
    assert c.get("/api/v1/immich/assets/a5").status_code == 404


def test_immich_erkennt_vorhandene_person_am_namen(client, immich):
    c = client
    vorhanden = c.post("/api/v1/entities", json={"name": "Lena  berg"}).json()   # andere Schreibweise
    c.put("/api/v1/importers/immich", json={"config": {"url": "http://immich.local:2283", "api_key": "geheim"}, "enabled": True})
    from syn import auth, db
    from syn.importe import run_importer
    status = run_importer(auth.ctx_for(db.q1("SELECT * FROM users LIMIT 1")), "immich")
    assert "2 neu, 1 erkannt" in status, status
    assert c.get(f"/api/v1/entities/{vorhanden['id']}/photos").json()["total"] == 260


def test_immich_untergrenze_fuer_unbenannte(client, immich):
    c = client
    c.put("/api/v1/importers/immich", json={"config": {"url": "http://immich.local:2283", "api_key": "geheim", "min_photos": "3"}, "enabled": True})
    from syn import auth, db
    from syn.importe import run_importer
    status = run_importer(auth.ctx_for(db.q1("SELECT * FROM users LIMIT 1")), "immich")
    # imm-2 (unbenannt, 1 Foto) bleibt draußen; benannte kommen auch mit 0 Fotos („Versteckt“)
    assert "2 gelesen, 2 neu" in status, status
    assert not any((x["description"] or "").startswith("Person von Fotos") for x in c.get("/api/v1/entities").json())
