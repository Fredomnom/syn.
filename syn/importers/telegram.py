from ..importe import Contact, Importer


class Telegram(Importer):
    id = "telegram"
    steps = [
        'Erstelle auf my.telegram.org unter „API development tools“ eine App und notiere api_id und api_hash.',
        'Führ auf dem Server einmal „python main.py telegram-login“ aus und folge den Fragen.',
        'Kopiere den ausgegebenen Session-String.',
        'Trag api_id, api_hash und Session-String hier ein.',
    ]
    name = "Telegram"
    way = "MTProto-Nutzer-API mit Telethon"
    official = "ja"
    brings = "Kontakte, Chats, letzte Nachricht"
    service = "telegram"
    requires = ["telethon"]
    rate = 0.5
    config = [
        {"key": "api_id", "label": "api_id", "type": "text", "required": True, "help": "von my.telegram.org"},
        {"key": "api_hash", "label": "api_hash", "type": "secret", "required": True},
        {"key": "session", "label": "Session-String", "type": "secret", "required": True,
         "help": "einmalig erzeugen mit: python main.py telegram-login"},
    ]

    def fetch(self, cfg, run):
        import asyncio
        return asyncio.run(self._fetch(cfg, run))

    async def _fetch(self, cfg, run):
        from telethon import TelegramClient, functions
        from telethon.sessions import StringSession
        client = TelegramClient(StringSession(cfg["session"]), int(cfg["api_id"]), cfg["api_hash"])
        await client.connect()
        if not await client.is_user_authorized():
            raise RuntimeError("Session abgelaufen – neu erzeugen mit: python main.py telegram-login")
        people = {}
        res = await client(functions.contacts.GetContactsRequest(hash=0))
        for u in res.users:
            people[u.id] = {"u": u, "last": None}
        async for d in client.iter_dialogs(limit=500):
            if d.is_user and not getattr(d.entity, "bot", False) and not getattr(d.entity, "is_self", False):
                p = people.setdefault(d.entity.id, {"u": d.entity, "last": None})
                if d.date:
                    p["last"] = d.date.date().isoformat()
        await client.disconnect()
        out = []
        for uid, p in people.items():
            u = p["u"]
            name = " ".join(x for x in (u.first_name, u.last_name) if x) or u.username
            out.append(Contact(service_id=str(uid), handle=u.username, name=name,
                               phones=[("+" + u.phone, "mobil")] if getattr(u, "phone", None) else [],
                               last_contact=p["last"], bot=bool(getattr(u, "bot", False))))
        return out


IMPORTER = Telegram()
