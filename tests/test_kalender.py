"""Kalender-Feeds: Datumsfelder als iCal, je Feld einmalig/monatlich/jährlich, mit Filtern und geheimer Adresse."""


def test_kalender_feed(client):
    c = client
    lena = c.post("/api/v1/entities", json={"name": "Lena Berg"}).json()
    c.put(f"/api/v1/entities/{lena['id']}/fields/f_bday", json={"values": [{"value": "1994-03-02"}]})
    ohne_jahr = c.post("/api/v1/entities", json={"name": "Ohne Jahr"}).json()
    c.put(f"/api/v1/entities/{ohne_jahr['id']}/fields/f_bday", json={"values": [{"value": "--02-29"}]})
    c.put(f"/api/v1/entities/{lena['id']}/fields/f_met", json={"values": [{"value": "2019-06-15"}]})
    nur_monat = c.post("/api/v1/entities", json={"name": "Vage"}).json()
    c.put(f"/api/v1/entities/{nur_monat['id']}/fields/f_bday", json={"values": [{"value": "1990-05"}]})

    f = c.post("/api/v1/calendars", json={"name": "Wichtige Tage", "fields": [
        {"field": "f_bday", "repeat": "yearly"}, {"field": "f_met", "repeat": "once"}]}).json()
    assert f["path"].startswith("/cal/") and f["path"].endswith(".ics")
    c.headers.pop("Authorization")                       # Kalender-Apps können sich nicht anmelden
    r = c.get(f["path"])
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    ics = r.text
    assert ics.startswith("BEGIN:VCALENDAR") and "X-WR-CALNAME:Wichtige Tage" in ics
    assert "SUMMARY:Lena Berg – Geburtstag" in ics and "DTSTART;VALUE=DATE:19940302" in ics and "RRULE:FREQ=YEARLY" in ics
    assert "DTSTART;VALUE=DATE:20000229" in ics            # ohne Jahr: Anker 2000, auch der 29.2.
    assert "DTSTART;VALUE=DATE:20190615" in ics            # einmalig
    assert ics.count("BEGIN:VEVENT") == 3                  # „1990-05“ ohne Tag fehlt
    assert all(len(l.encode()) <= 75 for l in ics.split("\r\n"))
    assert c.get("/cal/falsch.ics").status_code == 404


def test_kalender_filter_und_neuer_link(client):
    c = client
    k = c.post("/api/v1/circles", json={"name": "Verein", "kind_id": c.get("/api/v1/circle-kinds").json()["kinds"][0]["id"]}).json()
    a = c.post("/api/v1/entities", json={"name": "Im Verein"}).json()
    b = c.post("/api/v1/entities", json={"name": "Nicht im Verein"}).json()
    for e in (a, b):
        c.put(f"/api/v1/entities/{e['id']}/fields/f_bday", json={"values": [{"value": "2001-07-07"}]})
    c.post(f"/api/v1/circles/{k['id']}/members", json={"entity_id": a["id"]})
    f = c.post("/api/v1/calendars", json={"name": "Verein", "fields": [{"field": "f_bday", "repeat": "monthly"}], "circles": [k["id"]]}).json()
    ics = c.get(f["path"]).text
    assert "Im Verein" in ics and "Nicht im Verein" not in ics and "RRULE:FREQ=MONTHLY" in ics
    alt = f["path"]
    neu = c.post(f"/api/v1/calendars/{f['id']}/new-link").json()["path"]
    assert neu != alt and c.get(alt).status_code == 404 and c.get(neu).status_code == 200
    assert c.post("/api/v1/calendars", json={"fields": [{"field": "f_phone", "repeat": "yearly"}]}).status_code == 400
    c.delete(f"/api/v1/calendars/{f['id']}")
    assert c.get(neu).status_code == 404
