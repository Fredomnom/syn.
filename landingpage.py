"""syn – Landing Page als eigener kleiner Server (ohne die App, ohne Abhängigkeiten außer Python).

  python landingpage.py                    http://0.0.0.0:8090

Umgebungsvariablen:
  LANDING_HOST, LANDING_PORT   Adresse (Standard 0.0.0.0:8090)
  SYN_APP_URL                  Adresse einer laufenden syn-Instanz für „Zur App“ (leer = Knopf ausblenden)
  SYN_GITHUB_URL               Link zum Repository (leer = Platzhalter „kommt gleich“)
  SYN_IMAGE                    Docker-Image im Beispiel (Standard ghcr.io/OWNER/syn:latest)

Ausgeliefert werden nur die Dateien, die die Seite braucht (Whitelist) – nichts aus data/ oder dem Code.
Für HTTPS einen Reverse-Proxy (Caddy, nginx) davor setzen.
"""
import gzip
import html
import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB = Path(__file__).resolve().parent / "web"
HOST = os.environ.get("LANDING_HOST", "0.0.0.0")
PORT = int(os.environ.get("LANDING_PORT", "8090"))
CONFIG = {
    "app": os.environ.get("SYN_APP_URL", "").strip(),
    "github": os.environ.get("SYN_GITHUB_URL", "").strip(),
    "image": os.environ.get("SYN_IMAGE", "").strip() or None,
}

# Was die Seite lädt: Stylesheet, Übersetzung, Schriften, Symbole
ALLOWED_FILES = {"css/landing.css", "js/i18n.js", "i18n/en.json", "i18n/es.json", "icons/icon.svg",
                 "icons/icon-192.png", "icons/icon-512.png"}
ALLOWED_DIRS = ("fonts/",)
LONG_CACHE = ("fonts/", "icons/")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("text/javascript", ".js")


def render_index() -> bytes:
    page = (WEB / "landing.html").read_text("utf-8")
    cfg = json.dumps(CONFIG).replace("</", "<\\/")
    return page.replace("<!--SYN-CONFIG-->", f"<script>window.SYN_LANDING = {cfg};</script>", 1).encode()


class Handler(BaseHTTPRequestHandler):
    server_version = "syn-landing"
    sys_version = ""

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path in ("/", "/index.html", "/about"):
            return self.send(render_index(), "text/html; charset=utf-8", "no-cache", head)
        if path == "/healthz":
            return self.send(b"ok", "text/plain", "no-store", head)
        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            if ".." not in rel and (rel in ALLOWED_FILES or rel.startswith(ALLOWED_DIRS)):
                f = (WEB / rel).resolve()
                if f.is_file() and WEB in f.parents:
                    ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                    if ctype.startswith("text/") or ctype.endswith(("json", "javascript", "svg+xml")):
                        ctype += "; charset=utf-8"
                    cache = "public, max-age=604800" if rel.startswith(LONG_CACHE) else "no-cache"
                    return self.send(f.read_bytes(), ctype, cache, head)
        body = f"<!doctype html><meta charset=utf-8><title>404</title><p>Nicht gefunden: {html.escape(path)} – " \
               f"<a href='/'>zur Startseite</a></p>".encode()
        self.send(body, "text/html; charset=utf-8", "no-store", head, HTTPStatus.NOT_FOUND)

    def send(self, body: bytes, ctype: str, cache: str, head: bool, status=HTTPStatus.OK):
        if "gzip" in self.headers.get("Accept-Encoding", "") and not ctype.startswith(("font/", "image/png")) and len(body) > 1024:
            body = gzip.compress(body, 6)
            enc = True
        else:
            enc = False
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        if enc:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    print(f"syn Landing Page auf http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
