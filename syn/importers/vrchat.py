"""VRChat: Freundesliste über die (inoffizielle) Web-API, angemeldet mit dem Sitzungs-Cookie aus dem Browser.

Endpunkte (api.vrchat.cloud/api/1):
  GET /auth/user                         prüft die Anmeldung
  GET /auth/user/friends?offline=…&n&offset   Freunde, online und offline getrennt, je bis zu 100
VRChat verlangt einen eigenen User-Agent mit Kontakt; ohne wird die Anfrage abgelehnt.
"""
import httpx

from ..importe import Contact, Importer

API = "https://api.vrchat.cloud/api/1"
UA = "syn-contacts/1.0 (self-hosted contact book; https://github.com/Fredomnom/syn.)"
PAGE = 100


def _pic_headers(url, headers):
    """Das Anmelde-Cookie nur an VRChat selbst schicken – Bilder auf fremden Servern bekommen es nicht."""
    if not url:
        return None
    host = httpx.URL(url).host or ""
    own = host == "vrchat.com" or host.endswith((".vrchat.com", ".vrchat.cloud")) or host == "vrchat.cloud"
    return {"User-Agent": UA, "Cookie": headers["Cookie"]} if own else {"User-Agent": UA}


class VRChat(Importer):
    id = "vrchat"
    name = "VRChat"
    service = "vrchat"
    way = "Web-API mit dem Sitzungs-Cookie aus deinem Browser"
    official = "nein"
    brings = "Freunde mit Profilbild, deinen Notizen zu ihnen und ihrer Bio"
    unofficial = True
    rate = 1.0
    steps = [
        'Melde dich auf vrchat.com im Browser an (mit Zwei-Faktor, falls aktiv).',
        'Öffne die Entwicklerwerkzeuge (F12) → Speicher/Application → Cookies → https://vrchat.com.',
        'Kopiere den Wert des Cookies „auth“ (beginnt mit „authcookie_“).',
        'Falls vorhanden, kopiere auch „twoFactorAuth“ – damit bleibt die Anmeldung länger gültig.',
        'Füge die Werte hier ein und bestätige den Hinweis. Meldest du dich im Browser ab, wird das Cookie ungültig.',
    ]
    risk = ("VRChat hat keine offizielle API für Dritte. syn nutzt die Web-API so, wie die VRChat-Webseite es tut, "
            "nur lesend und langsam. Das Cookie ist ein Zugang zu deinem Konto – gib es nicht weiter. "
            "Theoretisch kann VRChat solche Zugriffe einschränken.")
    config = [
        {"key": "auth", "label": "Cookie „auth“", "type": "secret", "required": True,
         "help": "vrchat.com → Entwicklerwerkzeuge → Cookies → „auth“ (authcookie_…)"},
        {"key": "twofactor", "label": "Cookie „twoFactorAuth“ (optional)", "type": "secret", "required": False,
         "help": "Nur nötig, wenn dein Konto Zwei-Faktor nutzt und der Import sonst eine Bestätigung verlangt."},
        {"key": "offline", "label": "Auch Freunde, die gerade offline sind", "type": "select", "options": ["ja", "nein"]},
    ]

    @staticmethod
    def _cookie(cfg):
        auth = (cfg.get("auth") or "").strip()
        if auth.lower().startswith("auth="):
            auth = auth[5:]
        parts = [f"auth={auth}"]
        tfa = (cfg.get("twofactor") or "").strip()
        if tfa:
            parts.append("twoFactorAuth=" + (tfa[14:] if tfa.lower().startswith("twofactorauth=") else tfa))
        return "; ".join(parts)

    def fetch(self, cfg, run):
        headers = {"User-Agent": UA, "Cookie": self._cookie(cfg), "Accept": "application/json"}
        try:
            me = run.get(f"{API}/auth/user", headers=headers).json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise ValueError("VRChat lehnt die Anmeldung ab – das Cookie „auth“ ist abgelaufen oder falsch. "
                                 "Bitte neu aus dem Browser kopieren.") from None
            raise
        if me.get("requiresTwoFactorAuth"):
            raise ValueError("VRChat verlangt eine Zwei-Faktor-Bestätigung. Kopiere zusätzlich das Cookie "
                             "„twoFactorAuth“ aus dem Browser, oder melde dich dort neu an und kopiere „auth“ erneut.")
        run.log(f"Angemeldet als {me.get('displayName', '?')}")
        notes = self._notes(run, headers)
        if notes:
            run.log(f"{len(notes)} Notizen gefunden")
        modes = [False, True] if (cfg.get("offline") or "ja") == "ja" else [False]
        seen, out = set(), []
        total = len(me.get("friends") or []) or None
        run.progress(done=0, total=total, phase="Freunde laden")
        for offline in modes:
            offset = 0
            while True:
                page = run.get(f"{API}/auth/user/friends", headers=headers,
                               params={"offline": str(offline).lower(), "n": PAGE, "offset": offset}).json()
                for f in page:
                    uid = f.get("id")
                    if not uid or uid in seen:
                        continue
                    seen.add(uid)
                    out.append(self._contact(f, headers, notes.get(uid) or f.get("note")))
                run.progress(done=len(out))
                if len(page) < PAGE:
                    break
                offset += PAGE
        run.log(f"{len(out)} Freunde gefunden")
        return out

    @staticmethod
    def _notes(run, headers):
        """Deine eigenen Notizen zu Usern (VRChat → Profil → Notiz), seitenweise."""
        out, offset = {}, 0
        try:
            while True:
                page = run.get(f"{API}/userNotes", headers=headers, params={"n": PAGE, "offset": offset}).json()
                for n in page if isinstance(page, list) else []:
                    if n.get("targetUserId") and (n.get("note") or "").strip():
                        out[n["targetUserId"]] = n["note"].strip()
                if not isinstance(page, list) or len(page) < PAGE:
                    break
                offset += PAGE
        except httpx.HTTPError as e:
            run.log(f"Notizen nicht lesbar: {e}")
        return out

    @staticmethod
    def _contact(f, headers, my_note=None):
        name = f.get("displayName") or f.get("username")
        pic = f.get("userIcon") or f.get("profilePicOverrideThumbnail") or f.get("profilePicOverride") \
            or f.get("currentAvatarThumbnailImageUrl")
        bio = (f.get("bio") or "").strip()
        links = [x for x in (f.get("bioLinks") or []) if isinstance(x, str) and x.startswith("http")]
        about = "\n".join(filter(None, [bio, *links]))
        # deine Notiz zuerst, die Bio der Person darunter
        note = "\n\n".join(filter(None, [(my_note or "").strip(), ("VRChat-Bio: " + about) if about else ""])) or None
        return Contact(
            service_id=f["id"], handle=name, name=name,
            url=f"https://vrchat.com/home/user/{f['id']}",
            avatar_url=pic, avatar_headers=_pic_headers(pic, headers), note=note,
        )


IMPORTER = VRChat()
