"""Writes the 'Does the strategy win?' table into README.md from results/victory_<circuit>.json (python scripts/victory_table.py)."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
rows = []
for cid in ["silverstone", "spa", "monza", "zandvoort"]:
    p = root / "results" / f"victory_{cid}.json"
    if not p.exists():
        continue
    r = json.loads(p.read_text(encoding="utf-8"))
    for pace, block in r["paces"].items():
        for sc, v in block.items():
            a, b = v["adaptive"], v["baseline"]
            rows.append(f"| {cid} | {'fast car (-0.55 s)' if float(pace) < -0.1 else 'mid-field car (0.00 s)'} | {sc.replace('_', ' ')} | **{a['win_rate']:.0%}** | {b['win_rate']:.0%} | {a['mean_position']:.2f} | {b['mean_position']:.2f} | {v['mean_time_saved_s']:+.1f} s |")
n = json.loads((root / "results" / "victory_silverstone.json").read_text(encoding="utf-8"))["trials"]
table = ("| circuit | strategy car | scenario | wins: optimizer | wins: fixed stint | mean pos: optimizer | mean pos: fixed | time saved |\n"
         "|---|---|---|---|---|---|---|---|\n" + "\n".join(rows))
md = root / "README.md"
s = md.read_text(encoding="utf-8")
a, b = s.index("<!-- VICTORY_TABLE -->"), s.index("<!-- /VICTORY_TABLE -->")
s = s[:a] + "<!-- VICTORY_TABLE -->\n" + table + f"\n\n(Each row: {n} seeds, identical hidden world and the same 7 rule-based rivals for both strategies.)\n" + s[b:]
md.write_text(s, encoding="utf-8")
print(f"wrote {len(rows)} rows")
