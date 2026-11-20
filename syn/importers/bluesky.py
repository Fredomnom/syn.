from ..importe import Contact, Importer


class Bluesky(Importer):
    id = "bluesky"
    name = "Bluesky"
    way = "AT Protocol (öffentliche AppView)"
    official = "ja"
    brings = "gegenseitige Follows"
    service = "bluesky"
    config = [{"key": "handle", "label": "Dein Handle", "type": "text", "required": True,
               "placeholder": "name.bsky.social"},
              {"key": "only_mutual", "label": "Nur gegenseitige Follows", "type": "select", "options": ["ja", "nein"]}]
    API = "https://public.api.bsky.app/xrpc"

    def _all(self, run, method, actor, key):
        out, cursor = [], None
        while True:
            params = {"actor": actor, "limit": 100}
            if cursor:
                params["cursor"] = cursor
            r = run.get(f"{self.API}/{method}", params=params).json()
            out += r.get(key, [])
            cursor = r.get("cursor")
            if not cursor or len(out) > 10000:
                return out

    def fetch(self, cfg, run):
        h = cfg["handle"].lstrip("@")
        follows = {p["did"]: p for p in self._all(run, "app.bsky.graph.getFollows", h, "follows")}
        followers = {p["did"]: p for p in self._all(run, "app.bsky.graph.getFollowers", h, "followers")}
        ids = set(follows) & set(followers) if cfg.get("only_mutual", "ja") == "ja" else set(follows) | set(followers)
        out = []
        for did in ids:
            p = follows.get(did) or followers[did]
            out.append(Contact(service_id=did, handle=p["handle"], name=p.get("displayName") or p["handle"],
                               avatar_url=p.get("avatar")))
        return out


IMPORTER = Bluesky()
