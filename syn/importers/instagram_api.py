from ..importe import Contact, Importer


class InstagramApi(Importer):
    id = "instagram_api"
    steps = [
        'Öffne instagram.com im Browser und melde dich an.',
        'Entwicklertools (F12) → Anwendung/Speicher → Cookies → instagram.com.',
        'Kopiere den Wert von „sessionid“ und füge ihn hier ein.',
        'Bestätige den Hinweis – Instagram kann inoffizielle Zugriffe einschränken.',
    ]
    name = "Instagram (inoffiziell)"
    way = "inoffiziell mit instagrapi"
    official = "nein"
    brings = "Follower, Gefolgte"
    service = "instagram"
    unofficial = True
    requires = ["instagrapi"]
    rate = 3.0
    risk = ("instagrapi nutzt die private Instagram-App-API. Instagram kann Konten dafür vorübergehend sperren. "
            "syn liest nur und langsam.")
    config = [
        {"key": "sessionid", "label": "sessionid-Cookie", "type": "secret", "required": True,
         "help": "Instagram im Browser → Entwicklertools → Cookies → sessionid"},
    ]

    def fetch(self, cfg, run):
        from instagrapi import Client
        cl = Client()
        cl.delay_range = [2, 5]
        cl.login_by_sessionid(cfg["sessionid"])
        uid = cl.user_id
        followers = cl.user_followers(uid)
        following = cl.user_following(uid)
        out = []
        for pk, u in {**followers, **following}.items():
            out.append(Contact(service_id=str(pk), handle=u.username, name=u.full_name or u.username,
                               url=f"https://instagram.com/{u.username}",
                               avatar_url=str(u.profile_pic_url) if u.profile_pic_url else None))
        return out


IMPORTER = InstagramApi()
