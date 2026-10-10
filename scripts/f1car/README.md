# F1 car conversion

Turns the supplied `assets/f1/source/NEW F1 CAR 2026 NEW CAR.fbx` (about 1.6 M triangles, untextured carbon material, unlabelled parts)
into the two game-ready GLBs the web renderer loads: `frontend/public/assets/cars/f1/f1_hi.glb` (about 60 k triangles) and `f1_lo.glb`
(about 4.7 k, used beyond the quality preset's LOD distance).

```
cd scripts/f1car
npm install
npx fbx2gltf --binary --input "../../assets/f1/source/NEW F1 CAR 2026 NEW CAR.fbx" --output f1      # -> f1.glb
node build.mjs f1.glb ../../frontend/public/assets/cars/f1
```

`build.mjs` drops sub-10 cm detail parts, welds and decimates each group with meshoptimizer, remaps axes (Z up, nose at low Y ->
Y up, nose +Z), scales to a 5.57 m car, splits the four wheels (pivot at each axle centre, named `wheel-{front,back}-{left,right}`),
and writes three materials (`paint` = recolourable bodywork, `carbon`, `rubber`). Which source parts count as paint is the `PAINT` set at the top.
