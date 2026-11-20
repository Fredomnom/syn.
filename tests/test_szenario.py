"""Das Szenario aus dem Konzept: Eine Woche mit syn – über die API durchgespielt."""
import base64
from datetime import date, timedelta

from syn.util import today


def ent(c, eid):
    r = c.get(f"/api/v1/entities/{eid}")
    assert r.status_code == 200, r.text
    return r.json()


def test_woche(client):
    c = client
    # Vorbereitung: Klasse mit Kai Reuter, Max
    kl = c.post("/api/v1/circles", json={"name": "Klasse 10b", "kind_id": "schule"}).json()
    kai_r = c.post("/api/v1/entities", json={"name": "Kai Reuter", "circles": [kl["id"]],
                                            "fields": {"f_phone": [{"value": "0151 5550678", "label": "privat"}]}}).json()
    max_ = c.post("/api/v1/entities", json={"name": "Max Berger", "level": 3, "circles": [kl["id"]]}).json()

    # 1. Montag: jemanden ohne Namen erfassen
    s = c.get("/api/v1/capture/suggest", params={"text": "Typ aus dem Fitnessstudio"}).json()
    assert s["circle"]["name"] == "Fitnessstudio" and s["circle"]["new"]
    typ = c.post("/api/v1/entities/quick", json={"text": "Typ aus dem Fitnessstudio", "name_unknown": True,
                                                 "circle": s["circle"], "met_today": True, "seen_today": True}).json()
    assert typ["name"] is None and typ["description"] == "Typ aus dem Fitnessstudio"
    assert typ["fields"]["f_seen"][0]["value"] == today()
    assert typ["ihr_zwei"]["fields"]["f_met"][0]["value"] == today()
    fit = typ["memberships"][0]["circle_id"]
    # ohne Kreis → Lose
    lose = c.post("/api/v1/entities/quick", json={"text": "Barista mit Tattoo", "name_unknown": True}).json()
    assert lose["id"] in [r["id"] for r in c.get("/api/v1/entities", params={"filter": "lose"}).json()]

    # 2. Mittwoch: Heute gesehen, Name nachtragen (unsicher), Alias bleibt, Auswahlfeld, Duplikat-Hinweis
    r = c.post(f"/api/v1/seen-today/{typ['id']}").json()
    assert r["entity"]["fields"]["f_meet"][0]["value"] == 2
    e = c.patch(f"/api/v1/entities/{typ['id']}", json={"name": "Kai", "name_uncertain": True}).json()
    assert "Typ aus dem Fitnessstudio" in e["aliases"] and e["description"] is None
    e = c.patch(f"/api/v1/entities/{typ['id']}/fields/f_train", json={"value": ["Mittwoch"]}).json()
    assert e["fields"]["f_train"][0]["value"] == ["Mittwoch"]
    d = c.get("/api/v1/duplicates", params={"entity_id": typ["id"], "sensitivity": "all"}).json()
    assert any(kai_r["id"] in (p["a"], p["b"]) for p in d), d
    assert c.get("/api/v1/duplicates/check", params={"text": "Kai"}).json()[0]

    # 3. Zusammenführen: Klasse wird Hauptkreis, beide Kreise bleiben, Verlauf bleibt
    plan = c.get("/api/v1/merge/preview", params={"a": kai_r["id"], "b": typ["id"]}).json()
    assert any(f["field"] == "f_seen" for f in plan["fields"])
    m = c.post("/api/v1/merge", json={"keep": kai_r["id"], "other": typ["id"], "choices": {}}).json()
    assert m["name"] == "Kai Reuter"
    assert {x["circle_id"] for x in m["memberships"]} == {kl["id"], fit}
    assert m["main_circle_id"] == kl["id"]
    assert "Typ aus dem Fitnessstudio" in m["aliases"]
    hist = c.get(f"/api/v1/entities/{kai_r['id']}/history").json()
    assert any(h["attr"] == "merged" for h in hist) and any(h["attr"] == "f_train" for h in hist)
    assert c.get(f"/api/v1/entities/{typ['id']}").status_code == 404

    # 4. Einordnen: Ring per Zelle, Max einen Ring nach innen
    c.put(f"/api/v1/entities/{kai_r['id']}/ring", json={"level": 3})
    c.post("/api/v1/bulk", json={"ids": [max_["id"]], "op": "ring", "value": 2})
    rows = {r["id"]: r for r in c.get("/api/v1/entities").json()}
    assert rows[kai_r["id"]]["level"] == 3 and rows[max_["id"]]["level"] == 2

    # 5. Beziehungen: Ihr zwei = Freundschaft, Bund mit Max, Kennengelernt über → Kreis
    c.put(f"/api/v1/entities/{kai_r['id']}/ihr-zwei", json={"kind_id": "freundschaft"})
    b = c.post("/api/v1/bunds", json={"a_id": kai_r["id"], "b_id": max_["id"], "kind_id": "trainingspartner"})
    assert b.status_code == 200, b.text
    e = c.patch(f"/api/v1/entities/{kai_r['id']}/fields/f_via", json={"value": {"type": "circle", "id": fit}}).json()
    assert e["ihr_zwei"]["kind_id"] == "freundschaft"
    assert e["bunds"][0]["other_id"] == max_["id"]

    # 6. Routinen: Geburtstag enger Leute (ohne Geburtsjahr), Webhook-Vorschau, Test mit Person
    lisa = c.post("/api/v1/entities", json={"name": "Lisa Krämer", "level": 2,
                                           "fields": {"f_bday": "????-03-14", "f_email": ["lisa@example.org"]}}).json()
    routines = c.get("/api/v1/routines").json()
    bday = next(r for r in routines if r["name"] == "Geburtstag enger Leute")
    t = c.post("/api/v1/routines/test", json={"routine_id": bday["id"], "entity_id": lisa["id"]}).json()
    assert t["matches"] and t["next"].endswith("-03-14")
    assert t["payload"]["person"]["fields"]["f_bday"]["value"] == "????-03-14"
    assert t["preview"]["card"] == "Lisa Krämer hat Geburtstag"
    new = c.post("/api/v1/routines", json={
        "name": "Test-Hook", "trigger": {"type": "date", "field": "f_bday", "repeat": "yearly", "without_year": True},
        "conditions": [{"field": "f_level", "op": "<=", "value": 2}],
        "actions": [{"type": "webhook", "url": "http://127.0.0.1:9/hook"}, {"type": "card", "title": "{name}"}]})
    assert new.status_code == 200, new.text
    bad = c.post("/api/v1/routines", json={"name": "x", "trigger": {"type": "date", "field": "f_nope"}})
    assert bad.status_code == 400

    # 7. Die Routine feuert am 14. März: Karte „Alter unbekannt“
    from datetime import datetime
    from syn.modules import routinen
    yr = date.today().year + (1 if (date.today().month, date.today().day) > (3, 14) else 0)
    routinen.run_due(datetime(yr, 3, 14, 9, 0).astimezone())
    items = c.get("/api/v1/today").json()["items"]
    card = next(i for i in items if i["kind"] == "card" and i["entity_id"] == lisa["id"])
    assert card["title"] == "Lisa Krämer hat Geburtstag" and card["body"] == "Alter unbekannt"

    # 8. Überblick: Kreis-Vorschlag aus Netz (alle untereinander verbunden)
    ids = [c.post("/api/v1/entities", json={"name": n}).json()["id"] for n in ("Noah", "Ben", "Mia", "Clara")]
    for i in range(4):
        for j in range(i + 1, 4):
            c.post("/api/v1/bunds", json={"a_id": ids[i], "b_id": ids[j], "kind_id": "freundschaft"})
    sug = c.get("/api/v1/suggestions/circles").json()
    clique = next(s for s in sug if set(s["members"]) == set(ids))
    acc = c.post("/api/v1/suggestions/circles/accept", json=clique).json()
    assert len(c.get(f"/api/v1/circles/{acc['id']}").json()["members"]) == 4
    # Haustier-Filter
    c.post("/api/v1/entities", json={"name": "Bello", "kind": "pet", "fields": {"f_species": "Hund"}})
    pets = c.get("/api/v1/entities", params={"kind": "pet"}).json()
    assert [p["name"] for p in pets] == ["Bello"]


def test_unsicher_und_ungenaue_daten(client):
    c = client
    e = c.post("/api/v1/entities", json={"name": "Opa Heinz", "fields": {"f_bday": "Herbst 1940"}}).json()
    assert e["fields"]["f_bday"][0]["value"] == "1940-Herbst"
    e = c.put(f"/api/v1/entities/{e['id']}/fields/f_bday",
              json={"values": [{"value": "14.3.", "uncertain": True}]}).json()
    v = e["fields"]["f_bday"][0]
    assert v["value"] == "????-03-14" and v["uncertain"]


def test_mehrere_werte_veraltet_quelle(client):
    c = client
    e = c.post("/api/v1/entities", json={"name": "Tim Okafor"}).json()
    e = c.put(f"/api/v1/entities/{e['id']}/fields/f_phone", json={"values": [
        {"value": "+49 151 1111111", "label": "privat", "primary": True},
        {"value": "+49 30 2222222", "label": "Arbeit"}]}).json()
    vals = e["fields"]["f_phone"]
    assert vals[0]["primary"] and vals[0]["source"] == "manual"
    vals[1]["deprecated"] = True
    e = c.put(f"/api/v1/entities/{e['id']}/fields/f_phone", json={"values": vals}).json()
    assert any(v["deprecated"] for v in e["fields"]["f_phone"])
    # veraltete Nummer findet die Person bei Doppelten trotzdem
    o = c.post("/api/v1/entities", json={"name": "T. O.", "fields": {"f_phone": ["030 2222222"]}}).json()
    d = c.get("/api/v1/duplicates", params={"entity_id": o["id"]}).json()
    assert d and "gleiche Telefonnummer" in d[0]["reasons"]


def test_tokens_und_abkapselung(client, app):
    from fastapi.testclient import TestClient
    c = client
    tok = c.post("/api/v1/tokens", json={"name": "Türschild", "read_only": True}).json()["token"]
    ro = TestClient(app)
    ro.headers["Authorization"] = f"Bearer {tok}"
    assert ro.get("/api/v1/entities").status_code == 200
    assert ro.post("/api/v1/entities", json={"name": "x"}).status_code == 403
    # zweiter Nutzer sieht nichts vom ersten
    c.post("/api/v1/admin/users", json={"username": "anna", "password": "geheim456"})
    a = TestClient(app)
    t2 = a.post("/api/v1/auth/login", json={"username": "anna", "password": "geheim456"}).json()["token"]
    a.headers["Authorization"] = f"Bearer {t2}"
    mine = c.post("/api/v1/entities", json={"name": "Geheim"}).json()
    assert a.get(f"/api/v1/entities/{mine['id']}").status_code == 404
    assert all(r["is_self"] for r in a.get("/api/v1/entities").json())
    # eigener Eintrag gesperrt
    me = c.get("/api/v1/me").json()["self_id"]
    assert c.delete(f"/api/v1/entities/{me}").status_code == 400


def test_carddav(client, app):
    from fastapi.testclient import TestClient
    c = client
    e = c.post("/api/v1/entities", json={"name": "Sophie Wendt", "level": 2,
                                        "fields": {"f_phone": ["+49 160 5550391"], "f_bday": "????-07-02"}}).json()
    far = c.post("/api/v1/entities", json={"name": "Fern", "level": 4}).json()
    d = TestClient(app)
    auth = {"Authorization": "Basic " + base64.b64encode(b"fred:geheim123").decode()}
    assert d.request("PROPFIND", "/dav/", headers={**auth, "Depth": "0"}).status_code == 207
    r = d.request("PROPFIND", "/dav/fred/kontakte/", headers={**auth, "Depth": "1"})
    assert r.status_code == 207 and e["id"] in r.text and far["id"] not in r.text
    card = d.get(f"/dav/fred/kontakte/{e['id']}.vcf", headers=auth).text
    assert "FN:Sophie Wendt" in card and "X-APPLE-OMIT-YEAR" in card
    # Neuer Kontakt vom Handy → Lose
    vc = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:abc\r\nFN:Neu vom Handy\r\nTEL;TYPE=CELL:0170 1234567\r\nEND:VCARD\r\n"
    r = d.put("/dav/fred/kontakte/abc.vcf", content=vc, headers={**auth, "If-None-Match": "*"})
    assert r.status_code == 201
    lose = c.get("/api/v1/entities", params={"filter": "lose"}).json()
    assert any(x["name"] == "Neu vom Handy" for x in lose)
    # Löschen am Handy entfernt nur vom Handy
    d.delete(f"/dav/fred/kontakte/{e['id']}.vcf", headers=auth)
    assert c.get(f"/api/v1/entities/{e['id']}").status_code == 200
    assert d.request("PROPFIND", "/dav/", headers={"Depth": "0"}).status_code == 401


def test_vcard_import_und_quelle(client):
    c = client
    c.put("/api/v1/importers/vcard", json={"enabled": True})
    vc = ("BEGIN:VCARD\nVERSION:3.0\nFN:Mama\nTEL;TYPE=CELL:+49 171 5550001\nBDAY:1965-05-04\nEND:VCARD\n"
          "BEGIN:VCARD\nVERSION:3.0\nFN:Papa\nTEL;TYPE=HOME:0221 555002\nEND:VCARD\n")
    r = c.post("/api/v1/importers/vcard/run", files={"files": ("k.vcf", vc.encode(), "text/vcard")})
    assert r.status_code == 200 and "2 neu" in r.json()["status"], r.json()
    mama = next(x for x in c.get("/api/v1/entities", params={"q": "Mama"}).json())
    # Hand-Änderung wird beim nächsten Import nicht überschrieben
    c.patch(f"/api/v1/entities/{mama['id']}/fields/f_bday", json={"value": "1965-05-05"})
    r = c.post("/api/v1/importers/vcard/run", files={"files": ("k.vcf", vc.encode(), "text/vcard")})
    assert "0 neu" in r.json()["status"]
    e = c.get(f"/api/v1/entities/{mama['id']}").json()
    assert e["fields"]["f_bday"][0]["value"] == "1965-05-05"
    assert e["fields"]["f_phone"][0]["source"] == "vcard"


def test_notizen(client):
    c = client
    assert c.get("/api/v1/notes").status_code == 400
    c.patch("/api/v1/me/settings", json={"notes_enabled": True})
    a = c.post("/api/v1/entities", json={"name": "Lena Fischer"}).json()
    c.post("/api/v1/entities", json={"name": "Lena Bauer"})
    m = c.post("/api/v1/entities", json={"name": "Mia Schulz"}).json()
    n = c.post("/api/v1/notes", json={"text": "Mit Mia Schulz und Lena gekocht.", "dabei": [m["id"]]}).json()
    assert n["questions"] and n["questions"][0]["text"] == "Lena"
    n = c.put(f"/api/v1/notes/{n['id']}", json={"text": n["text"], "dabei": [m["id"]],
                                                "resolve": {"Lena": a["id"]}}).json()
    roles = {l["entity_id"]: l["role"] for l in n["links"]}
    assert roles == {m["id"]: "dabei", a["id"]: "erwähnt"}


def test_felder_und_ids(client):
    c = client
    f = c.post("/api/v1/fields", json={"name": "Kletterhalle", "type": "date", "scope": "person",
                                       "quick_action": "today"}).json()
    assert f["quick_routine_id"]
    e = c.post("/api/v1/entities", json={"name": "Clara"}).json()
    r = c.post(f"/api/v1/entities/{e['id']}/actions/{f['quick_routine_id']}").json()
    assert r["entity"]["fields"][f["id"]][0]["value"] == today()
    # Umbenennen bricht nichts
    c.patch(f"/api/v1/fields/{f['id']}", json={"name": "Bouldern zuletzt"})
    rt = c.post("/api/v1/routines", json={"name": "B", "trigger": {"type": "schedule", "every": "weekly"},
                                          "conditions": [{"field": f["id"], "op": "days_since_gt", "value": 10}],
                                          "actions": [{"type": "list"}]})
    assert rt.status_code == 200
    assert c.delete(f"/api/v1/fields/{f['id']}").status_code == 400  # wird in Routine benutzt


def test_rueckgaengig_und_wiederholen(client):
    c = client
    e = c.post("/api/v1/entities", json={"name": "Undo Ulla", "fields": {"f_city": "Köln"}}).json()
    c.patch(f"/api/v1/entities/{e['id']}/fields/f_city", json={"value": "Bonn"})
    c.patch(f"/api/v1/entities/{e['id']}", json={"name": "Ulla Umbenannt"})
    r = c.post("/api/v1/undo").json()
    assert r["label"] == "Person bearbeitet"
    x = c.get(f"/api/v1/entities/{e['id']}").json()
    assert x["name"] == "Undo Ulla" and x["fields"]["f_city"][0]["value"] == "Bonn"
    c.post("/api/v1/undo")
    x = c.get(f"/api/v1/entities/{e['id']}").json()
    assert x["fields"]["f_city"][0]["value"] == "Köln"
    hist = c.get(f"/api/v1/entities/{e['id']}/history").json()
    assert not any(h["attr"] == "f_city" and h["new"] == "Bonn" for h in hist)
    c.post("/api/v1/redo")
    assert c.get(f"/api/v1/entities/{e['id']}").json()["fields"]["f_city"][0]["value"] == "Bonn"
    # Rückgängig einer Löschung stellt alles wieder her
    c.delete(f"/api/v1/entities/{e['id']}")
    assert c.get(f"/api/v1/entities/{e['id']}").status_code == 404
    c.post("/api/v1/undo")
    assert c.get(f"/api/v1/entities/{e['id']}").json()["fields"]["f_city"][0]["value"] == "Bonn"
    # neue Änderung verwirft Wiederholen
    c.patch(f"/api/v1/entities/{e['id']}", json={"name": "Neu"})
    assert c.get("/api/v1/undo").json()["redo"] is None
    # Einstellungen rückgängig ändert nie das Passwort
    c.patch("/api/v1/me/settings", json={"notes_enabled": True})
    c.post("/api/v1/me/password", json={"old": "geheim123", "new": "geheim999"})
    c.post("/api/v1/undo")
    assert c.post("/api/v1/auth/login", json={"username": "fred", "password": "geheim999"}).status_code == 200


def test_kennengelernt_ueber_quelle(client):
    c = client
    c.put("/api/v1/importers/whatsapp", json={"enabled": True, "risk_ack": True})
    chat = ("12.03.25, 18:01 - Anna Alt: Hallo\n12.03.25, 18:02 - Bernd Bach: Hi\n13.03.25, 09:00 - Cora Cl: Moin\n")
    r = c.post("/api/v1/importers/whatsapp/run", files={"files": ("WhatsApp Chat mit Kletterteam.txt", chat.encode(), "text/plain")})
    assert "3 neu" in r.json()["status"], r.json()
    anna = c.get("/api/v1/entities", params={"q": "Anna Alt"}).json()[0]
    assert anna["v"]["f_via"]["raw"] == {"type": "service", "id": "whatsapp"}
    assert anna["v"]["f_via"]["d"] == "WhatsApp"
    sug = c.get("/api/v1/suggestions/circles").json()
    g = next(s for s in sug if s["name"] == "Kletterteam")
    assert len(g["members"]) == 3 and g["key"].startswith("group:")
    # Quelle ist kein Kreis-Vorschlag „Über WhatsApp“
    assert not any(s["name"].startswith("Über ") for s in sug)
    c.post("/api/v1/suggestions/circles/accept", json=g)
    assert not any(s["name"] == "Kletterteam" for s in c.get("/api/v1/suggestions/circles").json())
    # Hand gewinnt über die Quelle
    c.patch(f"/api/v1/entities/{anna['id']}/fields/f_via", json={"value": {"type": "service", "id": "instagram"}})
    c.post("/api/v1/importers/whatsapp/run", files={"files": ("WhatsApp Chat mit Kletterteam.txt", chat.encode(), "text/plain")})
    assert c.get(f"/api/v1/entities/{anna['id']}").json()["ihr_zwei"]["fields"]["f_via"][0]["value"]["id"] == "instagram"
    assert c.post("/api/v1/entities", json={"name": "X", "fields": {"f_via": {"value": {"type": "service", "id": "gibtsnicht"}}}}).status_code == 400
