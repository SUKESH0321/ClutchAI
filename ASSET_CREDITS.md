# Asset credits

All assets are stored locally under `frontend/public/assets/` and load offline at runtime. Every asset is CC0 / public domain
unless noted. Nothing is ripped from a game, and the cars use fictional liveries (no real teams, sponsors or drivers).

| Asset | Source | License | Author | Local path | Modifications |
|---|---|---|---|---|---|
| Asphalt Track (PBR, 1k) | https://polyhaven.com/a/asphalt_track | CC0 | Dimitrios Savva | `textures/asphalt_track/` | none (jpg diffuse/normal/ARM) |
| Asphalt pit lane (PBR, 1k) | https://polyhaven.com/a/asphalt_pit_lane | CC0 | Dimitrios Savva | `textures/asphalt_pit_lane/` | none |
| Grass ground (PBR, 1k) | https://polyhaven.com/a/grass_ground | CC0 | Charlotte Baglioni | `textures/grass_ground/` | none |
| Gravel / grass path (PBR, 1k) | https://polyhaven.com/a/gravel_grass_path_3 | CC0 | Rob Tuytel | `textures/gravel_grass_path_3/` | none |
| Concrete floor 02 (PBR, 1k) | https://polyhaven.com/a/concrete_floor_02 | CC0 | Rob Tuytel | `textures/concrete_floor_02/` | none |
| Rubber tiles (PBR, 1k) | https://polyhaven.com/a/rubber_tiles | CC0 | Amal Kumar | `textures/rubber_tiles/` | none |
| Kloofendal 48d partly cloudy (HDRI, 1k) | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | CC0 | Greg Zaal (Poly Haven) | `sky/` | none |
| Kloofendal overcast (HDRI, 1k) | https://polyhaven.com/a/kloofendal_overcast_puresky | CC0 | Greg Zaal (Poly Haven) | `sky/` | none |
| Old tyre (glTF) | https://polyhaven.com/a/old_tyre | CC0 | Poly Haven contributor | `environment/old_tyre/` | none |
| Kenney Racing Kit (grandstands, pits, tents, trees, gantry, barriers, lights) | https://kenney.nl/assets/racing-kit | CC0 | Kenney | `environment/kenney-racing-kit/` | placed/scaled at runtime; palette lightly remapped |
| Kenney Car Kit (race cars, wheels) | https://kenney.nl/assets/car-kit | CC0 | Kenney | `cars/` | team palette recoloured at runtime (canvas copy of colormap); wheels animated in code |
| Kenney Blocky Characters | https://kenney.nl/assets/blocky-characters | CC0 | Kenney | `characters/` | downloaded; not yet used in the scene (see README limitations) |
| Silverstone centre-line | https://github.com/TUMFTM/racetrack-database | LGPL-3.0 (OSM-derived, ODbL) | TUM Institute of Automotive Technology | `data/raw/Silverstone.csv` (resampled by `scripts/build_circuit.py`) | resampled to 720 points; start line, pit lane, sectors approximate |
| Barlow Condensed, JetBrains Mono (fonts) | Google Fonts | SIL OFL 1.1 | Jeremy Tribby; JetBrains | loaded from Google Fonts in `index.html` | none |

Licence texts: `frontend/public/assets/cars/LICENSE_Kenney_CarKit.txt`, `.../characters/LICENSE_Kenney_BlockyCharacters.txt`,
`.../environment/kenney-racing-kit/LICENSE.txt`, and per-asset `SOURCE.json` files beside the Poly Haven downloads
(the sky folder's `SOURCE.json` describes only the second HDRI downloaded). Re-download with `scripts/fetch_polyhaven.py`.
