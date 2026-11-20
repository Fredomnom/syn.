from ..importe import Contact, Importer


class GitHub(Importer):
    id = "github"
    name = "GitHub"
    way = "REST API"
    official = "ja"
    brings = "Follower, Gefolgte"
    service = "github"
    config = [{"key": "username", "label": "Dein GitHub-Name", "type": "text", "required": True},
              {"key": "token", "label": "Token (optional, höheres Limit)", "type": "secret"}]

    def _all(self, run, url, h):
        out = []
        while url:
            r = run.get(url, headers=h, params={"per_page": 100} if "?" not in url else None)
            out += r.json()
            url = r.links.get("next", {}).get("url")
        return out

    def fetch(self, cfg, run):
        h = {"Accept": "application/vnd.github+json"}
        if cfg.get("token"):
            h["Authorization"] = f"Bearer {cfg['token']}"
        u = cfg["username"]
        people = {a["id"]: a for a in self._all(run, f"https://api.github.com/users/{u}/followers", h)}
        people.update({a["id"]: a for a in self._all(run, f"https://api.github.com/users/{u}/following", h)})
        return [Contact(service_id=str(i), handle=a["login"], name=a["login"], url=a.get("html_url"),
                        avatar_url=a.get("avatar_url")) for i, a in people.items()]


IMPORTER = GitHub()
