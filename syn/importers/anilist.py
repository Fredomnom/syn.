from ..importe import Contact, Importer

Q = """query($id:Int!,$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage}
following(userId:$id){id name siteUrl avatar{large}}}}"""


class AniList(Importer):
    id = "anilist"
    name = "AniList"
    way = "GraphQL"
    official = "ja"
    brings = "gefolgte Nutzer"
    service = "anilist"
    config = [{"key": "username", "label": "Dein AniList-Name", "type": "text", "required": True}]

    def fetch(self, cfg, run):
        api = "https://graphql.anilist.co"
        uid = run.post(api, json={"query": "query($n:String){User(name:$n){id}}",
                                  "variables": {"n": cfg["username"]}}).json()["data"]["User"]["id"]
        out, page = [], 1
        while True:
            d = run.post(api, json={"query": Q, "variables": {"id": uid, "page": page}}).json()["data"]["Page"]
            for u in d["following"]:
                out.append(Contact(service_id=str(u["id"]), handle=u["name"], name=u["name"], url=u.get("siteUrl"),
                                   avatar_url=(u.get("avatar") or {}).get("large")))
            if not d["pageInfo"]["hasNextPage"]:
                return out
            page += 1


IMPORTER = AniList()
