# syn.

Selbst gehostetes Kontaktbuch für alle, die du kennst. Stand: Backend vollständig, Web-Oberfläche in Arbeit.

## Start
    python -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python main.py            # http://localhost:8080, API-Doku unter /api/docs
    .venv/bin/python -m pytest          # Tests (Szenario „Eine Woche mit syn“)

Erster Aufruf: `POST /api/v1/instance/setup` legt den Admin an (oder `SYN_ADMIN_USER`/`SYN_ADMIN_PASSWORD`).
CardDAV fürs Handy: `https://<host>/.well-known/carddav`, Login mit Passwort oder Long-lived Token.
