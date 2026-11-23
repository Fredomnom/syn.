"""Eigene Importer: Push statt Abruf, sonst wie eingebaute (Zuordnung, Quellen, Sperren)."""


def test_push_importer(client):
    c = client
    imp = c.post("/api/v1/importers/custom", json={"name": "Vereinsliste", "service": "verein"}).json()
    assert imp["id"] == "x_vereinsliste" and imp["push_url"].endswith("/x_vereinsliste/push")
    assert c.post("/api/v1/importers/custom", json={"name": "Vereinsliste"}).status_code == 409
    e = c.post("/api/v1/entities", json={"name": "Bekannt", "fields": {"f_phone": ["+49 170 1112223"]}}).json()
    r = c.post(f"/api/v1/importers/custom/{imp['id']}/push", json={"contacts": [
        {"service_id": "17", "name": "Neu Mitglied", "emails": ["neu@example.org"], "groups": ["Vorstand"]},
        {"service_id": "18", "name": "Irgendwer", "phones": ["0170 1112223"]},   # gleiche Nummer → erkannt
    ]}).json()
    assert r["stats"]["new"] == 1 and r["stats"]["matched"] == 1, r
    neu = next(x for x in c.get("/api/v1/entities", params={"q": "Neu Mitglied"}).json())
    full = c.get(f"/api/v1/entities/{neu['id']}").json()
    assert full["fields"]["f_email"][0]["source"] == "x_vereinsliste"
    assert any(p["value"].get("service") == "verein" for p in full["fields"].get("f_profile", []))
    # erneuter Push: dieselbe Person wird über die ID wiedererkannt, nicht doppelt angelegt
    r = c.post(f"/api/v1/importers/custom/{imp['id']}/push", json={"contacts": [{"service_id": "17", "name": "Neu Mitglied"}]}).json()
    assert r["stats"]["new"] == 0 and r["stats"]["matched"] == 1
    # Status steht wie bei eingebauten Importern
    assert c.get("/api/v1/importers/custom").json()[0]["last_status"].startswith("1 gelesen")
    # gelöscht → gesperrt → beim nächsten Push nicht wieder angelegt
    assert {s["id"] for s in c.get(f"/api/v1/entities/{neu['id']}/import-sources").json()} == {"x_vereinsliste"}
    c.request("DELETE", f"/api/v1/entities/{neu['id']}", json={"block": ["x_vereinsliste"]})
    r = c.post(f"/api/v1/importers/custom/{imp['id']}/push", json={"contacts": [{"service_id": "17", "name": "Neu Mitglied"}]}).json()
    assert r["stats"]["new"] == 0
    assert c.delete(f"/api/v1/importers/custom/{imp['id']}").status_code == 200
