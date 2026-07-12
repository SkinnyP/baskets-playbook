"""
Build-Skript für das Team-Playbook-Projekt.

Liest die strukturierten Daten aus data/ und generiert daraus:
  - exports/coach/dashboard.html      (Team-Übersicht für den Coach)
  - exports/players/<player_id>.html  (individueller Export je Spieler)

Aufruf: python3 scripts/build.py
"""
import base64
import json
import csv
import math
from itertools import count
from pathlib import Path
from collections import defaultdict
from jinja2 import Environment, FileSystemLoader
from markupsafe import Markup

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TEMPLATES = ROOT / "templates"
EXPORTS = ROOT / "exports"

env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=True)


# --------------------------------------------------------------------------
# Statisches SVG-Rendering der Spielzug-Diagramme.
# Fallback für Umgebungen ohne JavaScript (z. B. iOS Quick-Look-/WhatsApp-
# Vorschau): zeigt Aufstellung + alle Laufwege mit Schritt-Nummern.
# Die Geometrie spiegelt exakt die JS-Engine in templates/playbook.html.
# --------------------------------------------------------------------------
_diagram_uid = count(1)


def _qpoint(a, c, b, t):
    mt = 1 - t
    return (mt * mt * a[0] + 2 * mt * t * c[0] + t * t * b[0],
            mt * mt * a[1] + 2 * mt * t * c[1] + t * t * b[1])


_GUARD_DIST_MIN = 16
_GUARD_DIST_MAX = 46
_GUARD_BALL_REF = 220  # px Balldistanz, ab der die maximale Helpside-Distanz erreicht ist


def _basket_for(pos, full):
    if not full:
        return (150, 299)
    return (150, 41) if pos[1] < 310 else (150, 579)


def _guard_home_pos(attacker, basket, ball_pos=None):
    dx, dy = basket[0] - attacker[0], basket[1] - attacker[1]
    ln = math.hypot(dx, dy) or 1
    sag = _GUARD_DIST_MIN
    if ball_pos:
        bd = math.hypot(attacker[0] - ball_pos[0], attacker[1] - ball_pos[1])
        t = max(0.0, min(1.0, bd / _GUARD_BALL_REF))
        sag = _GUARD_DIST_MIN + (_GUARD_DIST_MAX - _GUARD_DIST_MIN) * t
    sag = min(sag, ln * 0.6)  # nicht zu nah am Korb / nicht über den Korb hinausschießen
    sag = max(sag, 10)  # trotzdem nie direkt auf dem Gegenspieler stehen (auch dicht am Ring)
    return (attacker[0] + dx / ln * sag, attacker[1] + dy / ln * sag)


def _guard_recover_pos(attacker, basket):
    dx, dy = attacker[0] - basket[0], attacker[1] - basket[1]
    ln = math.hypot(dx, dy) or 1
    ux, uy = dx / ln, dy / ln
    px, py = -uy, ux
    side = 1 if attacker[0] >= 150 else -1
    return (attacker[0] + ux * 8 + px * 14 * side, attacker[1] + uy * 8 + py * 14 * side)


def _wavy_d(frm, to, via):
    n = 24
    pts = []
    for i in range(n + 1):
        t = i / n
        if via:
            pts.append(_qpoint(frm, via, to, t))
        else:
            pts.append((frm[0] + (to[0] - frm[0]) * t, frm[1] + (to[1] - frm[1]) * t))
    d = f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"
    for i in range(1, len(pts)):
        dx, dy = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
        ln = math.hypot(dx, dy) or 1
        nx, ny = -dy / ln, dx / ln
        off = 0 if i >= len(pts) - 2 else math.sin(i * 1.35) * 4.5
        d += f" L{pts[i][0] + nx * off:.1f},{pts[i][1] + ny * off:.1f}"
    return d


def _court_svg(full):
    p = []
    if full:
        p.append('<rect x="8" y="8" width="284" height="604" fill="none" stroke="var(--line)" stroke-width="2"/>')
        p.append('<line x1="8" y1="310" x2="292" y2="310" stroke="var(--line)" stroke-width="2"/>')
        p.append('<circle cx="150" cy="310" r="40" fill="none" stroke="var(--line)" stroke-width="2"/>')
        # Brett 4ft / Ring 5.25ft von der Grundlinie (Maßstab: Zone = 19ft = 120px)
        for by, fy, mid_y, sweep, basket_y, bb_y, ft_y in [
            (612, 492, 535, 1, 579, 587, 492),
            (8, 8, 85, 0, 41, 33, 128),
        ]:
            p.append(f'<rect x="95" y="{fy}" width="110" height="120" fill="none" stroke="var(--line)" stroke-width="2"/>')
            p.append(f'<path d="M105,{ft_y} A45,45 0 0 {sweep} 195,{ft_y}" fill="none" stroke="var(--line)" stroke-width="2"/>')
            p.append(f'<path d="M28,{by} L28,{mid_y} A122,122 0 0 {sweep} 272,{mid_y} L272,{by}" fill="none" stroke="var(--line)" stroke-width="2"/>')
            p.append(f'<path d="M125,{basket_y} A25,25 0 0 {sweep} 175,{basket_y}" fill="none" stroke="var(--line)" stroke-width="2"/>')
            p.append(f'<line x1="132" y1="{bb_y}" x2="168" y2="{bb_y}" stroke="var(--text-mute)" stroke-width="3"/>')
            p.append(f'<circle cx="150" cy="{basket_y}" r="5" fill="none" stroke="var(--accent)" stroke-width="2"/>')
    else:
        # Brett 4ft / Ring 5.25ft von der Grundlinie (Maßstab: Zone = 19ft = 120px)
        p.append('<rect x="8" y="8" width="284" height="324" fill="none" stroke="var(--line)" stroke-width="2"/>')
        p.append('<rect x="95" y="212" width="110" height="120" fill="none" stroke="var(--line)" stroke-width="2"/>')
        p.append('<path d="M105,212 A45,45 0 0 1 195,212" fill="none" stroke="var(--line)" stroke-width="2"/>')
        p.append('<path d="M28,332 L28,255 A122,122 0 0 1 272,255 L272,332" fill="none" stroke="var(--line)" stroke-width="2"/>')
        p.append('<path d="M125,299 A25,25 0 0 1 175,299" fill="none" stroke="var(--line)" stroke-width="2"/>')
        p.append('<line x1="132" y1="307" x2="168" y2="307" stroke="var(--text-mute)" stroke-width="3"/>')
        p.append('<circle cx="150" cy="299" r="5" fill="none" stroke="var(--accent)" stroke-width="2"/>')
    return "".join(p)


def _trail_svg(action, pos, uid):
    out = []
    if action["type"] in ("switch", "beat", "help"):
        return out, None
    if action["type"] == "pass":
        f, to = pos[action["from"]], pos[action["to"]]
        out.append(f'<line x1="{f[0]:.1f}" y1="{f[1]:.1f}" x2="{to[0]:.1f}" y2="{to[1]:.1f}" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5,4" marker-end="url(#d{uid}-arrow-accent)"/>')
        mid = ((f[0] + to[0]) / 2, (f[1] + to[1]) / 2)
        return out, mid
    f = pos[action["id"]]
    to = (action["to"]["x"], action["to"]["y"])
    via = (action["via"]["x"], action["via"]["y"]) if action.get("via") else None
    if action["type"] == "dribble":
        out.append(f'<path d="{_wavy_d(f, to, via)}" fill="none" stroke="var(--text)" stroke-width="2" marker-end="url(#d{uid}-arrow-navy)"/>')
    elif action["type"] == "screen":
        dx, dy = to[0] - f[0], to[1] - f[1]
        ln = math.hypot(dx, dy) or 1
        nx, ny = -dy / ln, dx / ln
        out.append(f'<line x1="{f[0]:.1f}" y1="{f[1]:.1f}" x2="{to[0]}" y2="{to[1]}" stroke="var(--accent)" stroke-width="2.5"/>')
        out.append(f'<line x1="{to[0] + nx * 9:.1f}" y1="{to[1] + ny * 9:.1f}" x2="{to[0] - nx * 9:.1f}" y2="{to[1] - ny * 9:.1f}" stroke="var(--accent)" stroke-width="2.5"/>')
    else:
        if via:
            d = f"M{f[0]:.1f},{f[1]:.1f} Q{via[0]},{via[1]} {to[0]},{to[1]}"
        else:
            d = f"M{f[0]:.1f},{f[1]:.1f} L{to[0]},{to[1]}"
        out.append(f'<path d="{d}" fill="none" stroke="var(--text)" stroke-width="1.8" marker-end="url(#d{uid}-arrow-navy)"/>')
    mid = _qpoint(f, via, to, 0.5) if via else ((f[0] + to[0]) / 2, (f[1] + to[1]) / 2)
    return out, mid


def diagram_svg(diagram):
    """Rendert ein Diagramm als statisches SVG + nummerierte Schrittliste."""
    uid = next(_diagram_uid)
    full = diagram.get("court") == "full"
    vb = "0 0 300 620" if full else "0 0 300 340"
    p = [f'<div class="pd-static"><svg viewBox="{vb}" xmlns="http://www.w3.org/2000/svg">', "<defs>"]
    for name, col in [("accent", "var(--accent)"), ("navy", "var(--navy)"), ("mute", "var(--text-mute)")]:
        p.append(f'<marker id="d{uid}-arrow-{name}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{col}"/></marker>')
    p.append("</defs>")
    p.append(_court_svg(full))

    start_pos = {pl["id"]: (pl["x"], pl["y"]) for pl in diagram.get("players", [])}
    team = {pl["id"]: pl["team"] for pl in diagram.get("players", [])}
    pos = dict(start_pos)
    ball_holder = diagram.get("ball")
    guard_engine = bool(diagram.get("guardEngine"))
    guard_map = {pl["id"]: "O" + pl["id"][1:] for pl in diagram.get("players", []) if pl["team"] == "X"}
    manual_ids = {pl["id"] for pl in diagram.get("players", []) if pl.get("manual")}
    recovering = set()
    help_ids = set()
    explicit_this_step = set()
    beaten_this_step = set()
    badges = []
    branch = diagram.get("branch")
    steps = list(diagram.get("steps", []))
    default_option = None
    if branch and branch.get("options"):
        default_option = branch["options"][0]
        steps = steps + list(default_option.get("steps", []))
    ball_holder_before_step = ball_holder
    for i, step in enumerate(steps, start=1):
        ball_holder_before_step = ball_holder
        first_mid = None
        explicit_this_step = set()
        beaten_this_step = set()
        for action in step.get("actions", []):
            t = action["type"]
            if t == "switch":
                a, b = action["players"]
                guard_map[a], guard_map[b] = guard_map[b], guard_map[a]
                continue
            if t == "beat":
                beaten_this_step.add(action["id"])
                continue
            if t == "help":
                help_ids.add(action["id"])
                # Helfer übernimmt das Ziel als neuer primärer Verteidiger
                if action.get("target"):
                    guard_map[action["id"]] = action["target"]
                continue
            trail, mid = _trail_svg(action, pos, uid)
            p.extend(trail)
            if first_mid is None:
                first_mid = mid
            if t == "pass":
                ball_holder = action["to"]
            else:
                pos[action["id"]] = (action["to"]["x"], action["to"]["y"])
                explicit_this_step.add(action["id"])
        if first_mid is not None:
            badges.append(f'<circle cx="{first_mid[0]:.1f}" cy="{first_mid[1]:.1f}" r="8" fill="var(--accent)" stroke="#fff" stroke-width="1"/><text x="{first_mid[0]:.1f}" y="{first_mid[1] + 3:.1f}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">{i}</text>')
        for xid in explicit_this_step:
            recovering.discard(xid)
        recovering.update(beaten_this_step)

    if guard_engine:
        # Ball-Position VOR dem letzten Pass verwenden — sonst würde ein
        # bisher unbeteiligter Verteidiger im selben Moment eng zum Schützen
        # snappen, in dem der Ball bei ihm ankommt (Teleport-Effekt).
        ball_pos = pos.get(ball_holder_before_step)
        for xid, oid in guard_map.items():
            if xid in manual_ids or xid in beaten_this_step or xid in explicit_this_step:
                continue
            attacker = pos.get(oid, start_pos.get(oid))
            basket = _basket_for(attacker, full)
            pos[xid] = _guard_recover_pos(attacker, basket) if xid in recovering else _guard_home_pos(attacker, basket, ball_pos)

    is_finisher_valid = ball_holder in pos and team.get(ball_holder) == "O"

    for pl in diagram.get("players", []):
        pid = pl["id"]
        x, y = pos.get(pid, (pl["x"], pl["y"]))
        is_finisher = is_finisher_valid and pid == ball_holder
        if is_finisher:
            p.append(f'<circle cx="{x}" cy="{y}" r="15.5" fill="none" stroke="var(--accent)" stroke-width="2.5"/>')
        if pl["team"] == "O":
            fill = "var(--accent-light)" if is_finisher else "#fff"
            stroke = "var(--accent)" if is_finisher else "var(--navy)"
            p.append(f'<circle cx="{x}" cy="{y}" r="11" fill="{fill}" stroke="{stroke}" stroke-width="2.2"/>')
            p.append(f'<text x="{x}" y="{y + 3.5}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--navy)">{pl["label"]}</text>')
        else:
            if pid in help_ids:
                p.append(f'<circle cx="{x}" cy="{y}" r="14" fill="none" stroke="#F2C94C" stroke-width="2.5"/>')
            p.append(f'<rect x="{x - 9}" y="{y - 9}" width="18" height="18" fill="var(--cream)" stroke="var(--text-mute)" stroke-width="2" transform="rotate(45 {x} {y})"/>')
            p.append(f'<text x="{x}" y="{y + 3.5}" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--text-mute)">{pl["label"]}</text>')
    if ball_holder in pos:
        bx, by = pos[ball_holder]
        ball_r = 6 if is_finisher_valid else 4.5
        ball_fill = "var(--accent)" if is_finisher_valid else "#C97A2E"
        p.append(f'<circle cx="{bx + 9}" cy="{by + 9}" r="{ball_r}" fill="{ball_fill}" stroke="#7A4A1A" stroke-width="1"/>')
    p.extend(badges)
    p.append("</svg>")

    def esc(s):
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    prefix_len = len(diagram.get("steps", []))
    captions = [s.get("caption", "") for s in steps[:prefix_len]]
    if branch:
        captions.append(f'{branch.get("prompt", "")} — gezeigt: „{default_option.get("label", "")}“.')
        other_labels = [o.get("label", "") for o in branch["options"][1:]]
        if other_labels:
            captions.append("Weitere Optionen in der animierten Version: " + ", ".join(other_labels) + ".")
        captions += [s.get("caption", "") for s in steps[prefix_len:]]
    if captions:
        p.append('<ol class="pd-steps">')
        for c in captions:
            p.append(f"<li>{esc(c)}</li>")
        p.append("</ol>")
    p.append('<div class="pd-nojs-hint">Statische Ansicht (Vorschau ohne JavaScript). Für die animierte Version: Teilen-Symbol antippen → App „Safari“ auswählen.</div>')
    p.append("</div>")
    return Markup("".join(p))


env.globals["diagram_svg"] = diagram_svg


def load_data():
    players = json.loads((DATA / "players.json").read_text(encoding="utf-8"))
    playbook = json.loads((DATA / "playbook_content.json").read_text(encoding="utf-8"))

    stats_by_player = defaultdict(list)
    stats_csv = DATA / "stats" / "season_2026.csv"
    if stats_csv.exists():
        with open(stats_csv, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                stats_by_player[row["player_id"]].append(row)

    return players, playbook, stats_by_player


# --------------------------------------------------------------------------
# Regelbasierte Trainingstipps aus Statistiken.
# Bewusst simpel gehalten -- hier erweiterst du die Logik nach Bedarf.
# --------------------------------------------------------------------------
def make_tips(player, games):
    if not games:
        return []
    n = len(games)
    avg_to = sum(int(g["turnovers"]) for g in games) / n
    avg_reb = sum(int(g["rebounds"]) for g in games) / n
    avg_ast = sum(int(g["assists"]) for g in games) / n
    avg_min = sum(int(g["minutes"]) for g in games) / n

    tips = []
    if avg_to >= 2.5:
        tips.append("Deine Ballverlustquote ist zuletzt erhöht — Fokus in den nächsten Einheiten auf Ballhandling unter Druck (Kapitel 2, Fundamentals).")
    if avg_ast >= 5 and player["offense_role"] == "1":
        tips.append("Starke Assist-Quote — dein Passspiel öffnet dem Team gute Würfe. Weiter so als Tempo-Macher.")
    if avg_reb >= 8:
        tips.append("Sehr gute Rebound-Werte — du sicherst das Backboard zuverlässig ab.")
    if avg_min >= 27:
        tips.append("Hohe Einsatzzeit — achte auf Regeneration zwischen den Spieltagen.")
    if not tips:
        tips.append("Solide, ausgeglichene Leistung — weiter konsequent an den Fundamentals aus Kapitel 2 arbeiten.")
    return tips


def aggregate(games):
    n = len(games)
    if n == 0:
        return None
    return {
        "games": games,
        "avg_points": round(sum(int(g["points"]) for g in games) / n, 1),
        "avg_rebounds": round(sum(int(g["rebounds"]) for g in games) / n, 1),
        "avg_assists": round(sum(int(g["assists"]) for g in games) / n, 1),
        "avg_turnovers": round(sum(int(g["turnovers"]) for g in games) / n, 1),
    }


def _asset_data_uri(filename, mime="image/png"):
    path = DATA / "assets" / filename
    if not path.exists():
        return None
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def load_logo_uri():
    """Vereinslogo als Data-URI, damit die Exports offline funktionieren."""
    return _asset_data_uri("logo.png")


def load_touch_icon_uri():
    """Apple-Touch-Icon als Data-URI — Vereinslogo als Home-Bildschirm-Icon."""
    return _asset_data_uri("apple-touch-icon.png")


def build():
    players, playbook, stats_by_player = load_data()
    (EXPORTS / "players").mkdir(parents=True, exist_ok=True)
    (EXPORTS / "coach").mkdir(parents=True, exist_ok=True)

    season = playbook["season"]
    logo_uri = load_logo_uri()
    env.globals["touch_icon_uri"] = load_touch_icon_uri()
    team_stats = []
    flagged = []

    for player in players:
        games = stats_by_player.get(player["id"], [])
        agg = aggregate(games)

        stats_ctx = None
        if agg:
            stats_ctx = dict(agg)
            stats_ctx["tips"] = make_tips(player, games)

        tpl = env.get_template("player_export.html")
        html = tpl.render(
            season=season,
            logo_uri=logo_uri,
            player=player,
            stats=stats_ctx,
            fundamentals=playbook["fundamentals"],
            read_react=playbook.get("read_react", []),
            offense_8sec=playbook["offense_8sec"],
            defense_221=playbook["defense_221"],
            golden_rules=playbook["golden_rules"],
        )
        out_path = EXPORTS / "players" / f"{player['id']}.html"
        out_path.write_text(html, encoding="utf-8")
        print(f"  geschrieben: {out_path.relative_to(ROOT)}")

        if agg:
            row = dict(player)
            row.update(agg)
            row["games"] = len(games)
            team_stats.append(row)
            if agg["avg_turnovers"] >= 2.5:
                flagged.append(f"{player['name']}: erhöhte Ballverlustquote (Ø {agg['avg_turnovers']}/Spiel) — Ballhandling gezielt fördern.")

    tpl = env.get_template("coach_dashboard.html")
    html = tpl.render(season=season, logo_uri=logo_uri, team_stats=team_stats, flagged=flagged, players=players)
    dash_path = EXPORTS / "coach" / "dashboard.html"
    dash_path.write_text(html, encoding="utf-8")
    print(f"  geschrieben: {dash_path.relative_to(ROOT)}")

    tpl = env.get_template("playbook.html")
    html = tpl.render(
        season=season,
        logo_uri=logo_uri,
        fundamentals=playbook["fundamentals"],
        read_react_intro=playbook.get("read_react_intro"),
        read_react=playbook.get("read_react", []),
        resources=playbook.get("resources", []),
        offense_8sec=playbook["offense_8sec"],
        defense_221=playbook["defense_221"],
        pick_and_roll=playbook["pick_and_roll"],
        golden_rules=playbook["golden_rules"],
    )
    playbook_path = EXPORTS / "playbook.html"
    playbook_path.write_text(html, encoding="utf-8")
    print(f"  geschrieben: {playbook_path.relative_to(ROOT)}")

    tpl = env.get_template("drills.html")
    html = tpl.render(
        season=season,
        logo_uri=logo_uri,
        methodik=playbook.get("methodik"),
        drills=playbook.get("drills", []),
    )
    drills_path = EXPORTS / "drills.html"
    drills_path.write_text(html, encoding="utf-8")
    print(f"  geschrieben: {drills_path.relative_to(ROOT)}")


if __name__ == "__main__":
    print("Baue Team-Playbook-Exports...")
    build()
    print("Fertig.")
