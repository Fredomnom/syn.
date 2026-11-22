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
