# Basketball Team Playbook

**Hinweis zu diesem Repo:** Dies ist die Online-Kopie zum Weiterarbeiten an
Playbook, Drills und der Diagramm-Engine von einem beliebigen Rechner aus.
`data/players.json` und `data/stats/season_2026.csv` enthalten hier nur
Platzhalter-Daten — die echten Spielerdaten (Namen, Notizen, Statistiken)
bleiben ausschließlich im lokalen Hauptprojekt und werden nie hierher gepusht.
Für Playbook-Arbeit (Diagramme, Automatics, Templates, Build-Engine) reicht
diese Kopie vollständig aus.

`playbook.html` und `drills.html` im Repo-Root sind der gebaute Output für
GitHub Pages (https://skinnyp.github.io/baskets-playbook/) — nach jeder
Änderung `python scripts/build.py` laufen lassen und die beiden Dateien aus
`exports/` hierher kopieren, bevor du committest.

---

Ursprünglich ein lokales Projekt (kein Hosting) zur Verwaltung von Playbook,
Spielerdatenbank und Statistiken. Erzeugt individuelle HTML-Exports pro
Spieler, die du per WhatsApp/AirDrop teilst — kein Server, kein Login.

## Struktur

```
data/
  players.json            Spielerdatenbank: Rollen, Stärken, Fokusbereiche, Notizen
  playbook_content.json   Playbook-Inhalte — EINZIGE Quelle der Wahrheit
  stats/season_2026.csv   Spielstatistiken pro Spiel und Spieler
templates/
  base.html                Gemeinsames Grunddesign (Farben, Fonts, Layout)
  player_export.html       Template für den individuellen Spieler-Export
  coach_dashboard.html     Template für deine Team-Übersicht
scripts/
  build.py                 Generiert alle HTML-Dateien aus den Daten
exports/
  coach/dashboard.html     Für dich: Team-Übersicht mit Stats & Trends
  players/<player_id>.html Für jeden Spieler: Playbook + persönliche Stats + Tipps
  playbook.html            Team-Playbook mit animierten Spielzug-Diagrammen
  drills.html              Trainingsübungen (Methodik + Drills)
```

## Workflow

1. Playbook aktualisieren → `data/playbook_content.json` bearbeiten
2. Spieler/Rollen aktualisieren → `data/players.json` bearbeiten
3. Neues Spiel eintragen → Zeile in `data/stats/season_2026.csv` anhängen
4. Bauen: `python3 scripts/build.py`
5. Ergebnis liegt in `exports/` — Dateien aus `exports/players/` einzeln teilen

## Git-Workflow

Jede inhaltliche Änderung (neues Spiel, Playbook-Update, neuer Spieler) ist ein
eigener Commit. So hast du eine nachvollziehbare Saison-Historie:

```
git add data/
git commit -m "Spieltag 12.07.: Stats + Playbook-Update Trap-Regel"
python3 scripts/build.py
git add exports/
git commit -m "Exports für Spieltag 12.07. generiert"
```

## Automatisch generierte Spieler-Tipps

`scripts/build.py` enthält einfache regelbasierte Logik (`tips.py`-Abschnitt),
die aus den Statistiken automatisch Trainingshinweise ableitet, z. B.:
hohe Ballverlustquote → Ballhandling-Fokus vorschlagen. Das ist bewusst simpel
gehalten und in `scripts/build.py` klar kommentiert — dort erweiterst du die Regeln.

## Ideen für später (bewusst nicht jetzt umgesetzt)

- Web-Hosting mit Login pro Spieler (z. B. Vercel + Supabase)
- Automatischer Export als PWA (installierbar, offline-fest)
- Fortgeschrittenere Statistik-Auswertung (z. B. Plus/Minus, Presse-Erfolgsquote)
- CSV-Import aus Turnier-Apps statt manueller Eingabe

Diese Punkte sind absichtlich nicht gebaut — das Projekt bleibt lokal und einfach,
bis du entscheidest, dass sich der nächste Schritt lohnt.
