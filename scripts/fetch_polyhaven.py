"""Download CC0 assets from Poly Haven (https://polyhaven.com) into a target folder.

Poly Haven publishes every texture, HDRI and model under CC0 (public domain); the API is public and needs no key.
This script is how the assets in frontend/public/assets were obtained, so the provenance is reproducible.

Usage (from repo root, with any Python 3):
    python scripts/fetch_polyhaven.py tex asphalt_track  frontend/public/assets/textures/asphalt_track  [res=1k]
    python scripts/fetch_polyhaven.py hdri kloofendal_48d_partly_cloudy_puresky  frontend/public/assets/sky  [res=1k]
    python scripts/fetch_polyhaven.py model old_tyre  frontend/public/assets/environment/old_tyre  [res=1k]

Textures: Diffuse + OpenGL normal + ARM (AO in R, roughness in G, metalness in B), JPG.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

UA = {"User-Agent": "clutchai-asset-fetch"}


def get_json(url: str):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def download(url: str, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        data = r.read()
    dest.write_bytes(data)
    return len(data)


def main() -> None:
    kind, asset, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    res = sys.argv[4] if len(sys.argv) > 4 else "1k"
    info = get_json(f"https://api.polyhaven.com/info/{asset}")
    files = get_json(f"https://api.polyhaven.com/files/{asset}")
    meta = {"asset": asset, "name": info.get("name"), "authors": info.get("authors"),
            "url": f"https://polyhaven.com/a/{asset}", "license": "CC0 1.0 (https://polyhaven.com/license)", "resolution": res}
    total = 0
    if kind == "tex":
        for key, fname in (("Diffuse", "diffuse.jpg"), ("nor_gl", "normal.jpg"), ("arm", "arm.jpg")):
            total += download(files[key][res]["jpg"]["url"], out / fname)
    elif kind == "hdri":
        total += download(files["hdri"][res]["hdr"]["url"], out / f"{asset}_{res}.hdr")
    elif kind == "model":
        g = files["gltf"][res]["gltf"]
        total += download(g["url"], out / Path(g["url"]).name)
        for rel, inc in g.get("include", {}).items():
            total += download(inc["url"], out / rel)
    else:
        raise SystemExit("kind must be tex | hdri | model")
    out.mkdir(parents=True, exist_ok=True)
    (out / "SOURCE.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"{kind} {asset} ({res}): {total / 1e6:.2f} MB -> {out}  [{meta['authors']}]")


if __name__ == "__main__":
    main()
