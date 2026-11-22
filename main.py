"""syn – Einstieg. Lädt die API-Module und startet den Server.

  python main.py                     Server starten (SYN_HOST/SYN_PORT, Standard 0.0.0.0:8080)
  python main.py create-user NAME    Konto anlegen (fragt nach dem Passwort; --admin für Admin)
  python main.py telegram-login      Session-String für den Telegram-Import erzeugen
"""
import asyncio
import importlib
from contextlib import asynccontextmanager
import logging
import sys

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from syn import config, db

# Je ein Modul für Lebewesen, Kreise, Bünde, Felder, Verlauf, Routinen und Importe – plus Konten, Sync & Co.
MODULES = ["konten", "lebewesen", "kreise", "buende", "felder", "verlauf", "routinen", "importe_api", "dubletten",
           "vorschlaege", "notizen", "dateien", "carddav", "google_sync", "undo", "visitenkarte", "immich_api", "kalenderfeeds", "selbstauskunft"]


def create_app() -> FastAPI:
    db.init()
    mods = [importlib.import_module(f"syn.modules.{name}") for name in MODULES]

    @asynccontextmanager
    async def lifespan(app):
        tasks = [asyncio.create_task(m.background()) for m in mods if hasattr(m, "background")]
        yield
        for t in tasks:
            t.cancel()

    app = FastAPI(title="syn", version="1.0.0", description="Das Kontaktbuch für alle, die du kennst. "
                  "Alles, was die Oberfläche kann, geht auch über diese API.",
                  docs_url=None, redoc_url=None, openapi_url="/api/openapi.json", lifespan=lifespan)
    for mod in mods:
        app.include_router(mod.router)
        if hasattr(mod, "install"):
            mod.install(app)

    @app.middleware("http")
    async def no_stale_ui(request: Request, call_next):
        # Oberfläche immer frisch: der Browser fragt bei jedem Aufruf nach (304, wenn unverändert)
        resp = await call_next(request)
        p = request.url.path
        if p.startswith("/static/") or p in ("/", "/sw.js", "/manifest.webmanifest"):
            if not p.startswith(("/static/fonts/", "/static/icons/")):
                resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.exception_handler(ValueError)
    async def value_error(request: Request, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.get("/api/docs", include_in_schema=False)
    def api_docs():
        # eigene Dokumentation in der Oberfläche – ohne fremde CDNs
        from fastapi.responses import RedirectResponse
        return RedirectResponse("/#/api")

    @app.get("/api/v1/health", tags=["Konten"])
    def health():
        return {"ok": True}

    web = config.WEB_DIR
    app.mount("/static", StaticFiles(directory=web), name="static")

    @app.get("/sw.js", include_in_schema=False)
    def sw():
        return FileResponse(web / "sw.js", media_type="application/javascript",
                            headers={"Cache-Control": "no-cache"})

    @app.get("/manifest.webmanifest", include_in_schema=False)
    def manifest():
        return FileResponse(web / "manifest.webmanifest", media_type="application/manifest+json")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(web / "index.html", headers={"Cache-Control": "no-cache"})

    bootstrap_admin()
    from syn.importe import backfill_via
    from syn.seed import backfill_circles, backfill_services, backfill_new_services, backfill_meet_dates, backfill_views, backfill_icons
    backfill_via()
    backfill_circles()
    backfill_services()
    backfill_new_services()
    backfill_meet_dates()
    backfill_views()
    backfill_icons()
    return app


def bootstrap_admin():
    if config.ADMIN_USER and config.ADMIN_PASSWORD and not db.val("SELECT 1 FROM users LIMIT 1"):
        from syn.modules.konten import create_user
        create_user(config.ADMIN_USER, config.ADMIN_PASSWORD, config.ADMIN_USER, True)
        logging.getLogger("syn").info("Admin %s angelegt", config.ADMIN_USER)


def cli():
    args = sys.argv[1:]
    if args and args[0] == "create-user":
        import getpass
        db.init()
        from syn.modules.konten import create_user
        name = args[1] if len(args) > 1 else input("Benutzername: ")
        pw = getpass.getpass("Passwort: ")
        create_user(name, pw, name, "--admin" in args)
        print(f"Konto {name} angelegt.")
        return
    if args and args[0] == "telegram-login":
        try:
            from telethon.sessions import StringSession
            from telethon.sync import TelegramClient
        except ImportError:
            print("Bitte zuerst installieren: pip install telethon")
            return
        api_id = int(input("api_id (my.telegram.org): "))
        api_hash = input("api_hash: ")
        with TelegramClient(StringSession(), api_id, api_hash) as c:
            print("\nSession-String (in syn beim Telegram-Import einfügen):\n")
            print(c.session.save())
        return
    import uvicorn
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(create_app(), host=config.HOST, port=config.PORT, proxy_headers=True, forwarded_allow_ips="*")


if __name__ == "__main__":
    cli()
