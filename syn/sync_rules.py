"""Wer aufs Handy kommt: Jeder, nach Regel oder niemand – plus Schalter „aufs Handy“ pro Person."""
from . import model


def rule_match(ctx, row, rule) -> bool:
    t = rule.get("type")
    if t == "level":
        return row["level"] is not None and row["level"] <= int(rule.get("max", 4))
    if t == "circles":
        return bool(set(rule.get("ids") or []) & set(row["circles_all"]))
    if t == "circle_kinds":
        kinds = set(rule.get("ids") or [])
        cs = model.circles(ctx.uid)
        return any(cs[c]["kind_id"] in kinds for c in row["circles_all"] if c in cs)
    if t == "kind":
        return row["kind"] == rule.get("value", "person")
    if t == "has_phone":
        return "f_phone" in row["v"]
    return False


def synced(ctx, row) -> bool:
    if row.get("is_self"):
        return False
    s = ctx.settings.get("sync") or {}
    mode = s.get("mode", "rule")
    if mode == "all":
        return True
    if row.get("on_phone"):
        return True
    if mode == "none":
        return False
    rules = s.get("rules") or []
    if not rules:
        return False
    res = [rule_match(ctx, row, r) for r in rules]
    return all(res) if s.get("match") == "all" else any(res)


def synced_rows(ctx):
    return [r for r in model.load_rows(ctx) if synced(ctx, r)]
