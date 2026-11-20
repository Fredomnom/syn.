# syn.

The contact book for everyone you know. Self-hosted, open source, multiple users per instance (strictly separated).

**Website:** https://syn.fredomnom.com

The interface speaks German, English and Spanish. It follows your browser language and falls back to English;
you can change it in the settings.

## Getting started

    python -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python main.py                 # http://localhost:8080

On first visit you create the admin account in the browser (or beforehand via `SYN_ADMIN_USER` / `SYN_ADMIN_PASSWORD`,
or `python main.py create-user NAME --admin`). The admin creates further accounts under Settings → Accounts.

### Docker

```sh
SYN_ADMIN_PASSWORD=change-me-123 docker compose up -d      # http://localhost:8080
# or by hand:
docker build -t syn .
docker run -d -p 8080:8080 -v syn-data:/data -e SYN_ADMIN_USER=you -e SYN_ADMIN_PASSWORD=change-me-123 syn
```

The image runs as its own user (not root), has a health check on `/api/v1/health` and keeps everything under `/data`.

There are two variants built from the same Dockerfile:

| Tag | Build | Contains |
|---|---|---|
| `latest` (slim) | `docker build -t ghcr.io/fredomnom/syn:latest .` | everything except the importers below |
| `full` | `docker build --target full -t ghcr.io/fredomnom/syn:full .` | additionally Telegram (`telethon`), Instagram API (`instagrapi`, unofficial), PlayStation (`psnawp`) |

The Signal importer needs `signal-cli` (Java) on the host and is not part of either image.
More packages for both variants: `--build-arg EXTRAS="pkg1 pkg2"`.
Business cards live at `/@name`.

### systemd

Adjust `syn.service` (paths) and copy it to `/etc/systemd/system/`.

### Configuration

| Variable | Meaning |
|---|---|
| `SYN_DATA` | Data folder (SQLite, files, `secret.key`) – back it up! |
| `SYN_HOST`, `SYN_PORT` | Address, default `0.0.0.0:8080` |
| `SYN_SESSION_HOURS` | Lifetime of login tokens (default 24, extended on use) |
| `SYN_DISABLE_IMPORTERS` | Importers disabled globally, e.g. `discord,whatsapp` |
| `SYN_SECRET_KEY` | Optional instead of `data/secret.key` (key for stored import tokens) |
| `SYN_ADMIN_USER`, `SYN_ADMIN_PASSWORD` | Creates the first admin account if none exists |

Put a reverse proxy (Caddy, nginx, Traefik, Cloudflare Tunnel) in front for HTTPS. Enter the public host name under
Settings → Sync so contacts on your phone carry a link to the person's page.

## Phone

- **Web app (PWA):** open the page in your browser → “Add to Home Screen”. Captures made offline are queued.
- **Contact sync (CardDAV):** Settings → Phone & Sync → “Show QR code” sets up iPhone (profile) or Android (DAVx⁵) by scanning.
  By hand: iPhone: Settings → Contacts → Accounts → CardDAV, server = your syn address.
  Android: DAVx⁵ with `https://<host>/dav/`. Best use a separate long-lived token as the password.
- **Alternatively Google Contacts:** Settings → Sync (needs your own OAuth client, instructions there).

## Usage

- **Keyboard shortcuts:** all can be rebound under Settings → Keyboard shortcuts (`Shift+?` shows the overview).
  Defaults include sidebar `Ctrl/⌘+B`, search `Ctrl/⌘+K`, undo `Ctrl/⌘+Z`, redo `Ctrl/⌘+Shift+Z`.
- **Undo/redo** covers every change (including deleting, merging, imports) – per user, the last 200 steps.
  Passwords and permissions are never reset by it.
- **Appearance:** light, dark or follow the system (Settings → Account, on the phone under “Me”).
- **Business card:** a short link like `/@you` (and a QR code) – whoever opens it sees what you share and can send their details back.

## API

Everything the interface can do is available through the API (the interface uses nothing else). Docs: `/api/docs`.
Long-lived tokens under Settings → Account, optionally read-only. `Authorization: Bearer syn_…`

## Landing page

`landingpage.py` serves the project page on its own – a tiny server using only the Python standard library that delivers
nothing but the page and its assets (no app, no data):

```sh
SYN_GITHUB_URL=https://github.com/Fredomnom/syn. SYN_APP_URL=https://syn.example.org python landingpage.py   # http://localhost:8090
```

| Variable | Meaning |
|---|---|
| `LANDING_HOST`, `LANDING_PORT` | Address, default `0.0.0.0:8090` |
| `SYN_APP_URL` | A running syn instance for the “Open app” button (empty = hide the button) |
| `SYN_GITHUB_URL` | Link to the repository |
| `SYN_IMAGE` | Docker image shown in the example |

## Structure

- `main.py` loads the modules from `syn/modules/` (people, circles, bonds, fields, history, routines, imports, …).
- `syn/importers/` – one module per service, switchable globally (admin) and per user.
- `web/` – interface without a build step (phone and desktop are deliberately two interfaces).
- Tech: Python, FastAPI, SQLite. Import credentials are encrypted per user (Fernet).
- Undo uses SQLite triggers (function `syn_batch`). So don't write to the database with other tools while syn
  is running – reading is fine.

## Development

    .venv/bin/python -m pytest                              # tests, including the scenario “A week with syn”
    .venv/bin/python scripts/demo_daten.py http://localhost:8080 demo demo1234   # sample data (made up)

Optional packages for individual importers: `telethon` (Telegram), `instagrapi` (Instagram, unofficial), `psnawp` (PlayStation).
`signal-cli` must be installed on the server for the Signal import.

## License

MIT – see [LICENSE](LICENSE).
