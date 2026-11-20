# syn.

Das Kontaktbuch für alle, die du kennst. Selbst gehostet, Open Source, mehrere Nutzer pro Instanz (strikt getrennt).

## Starten

    python -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python main.py                 # http://localhost:8080

Beim ersten Aufruf legst du im Browser das Admin-Konto an (oder vorab per `SYN_ADMIN_USER` / `SYN_ADMIN_PASSWORD`,
oder `python main.py create-user NAME --admin`). Weitere Konten legt der Admin unter Einstellungen → Konten an.

**Docker:** `docker build -t syn . && docker run -p 8080:8080 -v syn-data:/data syn`
**systemd:** `syn.service` anpassen (Pfade) und nach `/etc/systemd/system/` kopieren.

| Variable | Bedeutung |
|---|---|
| `SYN_DATA` | Datenordner (SQLite, Dateien, `secret.key`) – sichern! |
| `SYN_HOST`, `SYN_PORT` | Adresse, Standard `0.0.0.0:8080` |
| `SYN_SESSION_HOURS` | Lebensdauer von Login-Tokens (Standard 24, verlängert sich bei Benutzung) |
| `SYN_DISABLE_IMPORTERS` | global ausgeschaltete Importer, z.B. `discord,whatsapp` |
| `SYN_SECRET_KEY` | optional statt `data/secret.key` (Schlüssel für gespeicherte Import-Tokens) |

Für HTTPS einen Reverse-Proxy (Caddy, nginx, Traefik) davor setzen. Den öffentlichen Hostnamen in
Einstellungen → Sync eintragen, damit Kontakte am Handy einen Link zur Personenseite tragen.

## Handy

- **Web-App (PWA):** Seite im Browser öffnen → „Zum Home-Bildschirm“. Erfassungen ohne Netz werden gepuffert.
- **Kontakte-Sync (CardDAV):** iPhone: Einstellungen → Kontakte → Accounts → CardDAV, Server = deine syn-Adresse.
  Android: DAVx⁵ mit `https://<host>/dav/`. Als Passwort am besten ein eigenes Long-lived Token.
- **Alternativ Google Kontakte:** Einstellungen → Sync (eigener OAuth-Client nötig, Anleitung dort).

## API

Alles, was die Oberfläche kann, geht auch über die API (die Oberfläche nutzt nur sie). Doku: `/api/docs`.
Long-lived Tokens unter Einstellungen → Konto, optional nur lesend. `Authorization: Bearer syn_…`

## Aufbau

- `main.py` lädt die Module aus `syn/modules/` (Lebewesen, Kreise, Bünde, Felder, Verlauf, Routinen, Importe, …).
- `syn/importers/` – ein Modul pro Dienst, global (Admin) und pro Nutzer an- und ausschaltbar.
- `web/` – Oberfläche ohne Build-Schritt (Handy und Desktop sind bewusst zwei Oberflächen).
- Technik: Python, FastAPI, SQLite. Import-Zugangsdaten sind pro Nutzer verschlüsselt (Fernet).

## Entwicklung

    .venv/bin/python -m pytest                              # Tests, u.a. das Szenario „Eine Woche mit syn“
    .venv/bin/python scripts/demo_daten.py http://localhost:8080 demo demo1234   # Beispieldaten (ausgedacht)

Optionale Pakete für einzelne Importer: `telethon` (Telegram), `instagrapi` (Instagram inoffiziell), `psnawp` (PlayStation).
`signal-cli` muss für den Signal-Import auf dem Server installiert sein.
