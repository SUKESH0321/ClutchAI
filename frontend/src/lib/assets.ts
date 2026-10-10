/** Locations of the locally bundled assets (frontend/public/assets). Nothing is fetched from the network at runtime. */
export const asset = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;

/** Poly Haven PBR texture set: diffuse + OpenGL normal + ARM (AO in R, roughness in G, metalness in B). */
export const pbr = (name: string) => ({
  map: asset(`textures/${name}/diffuse.jpg`),
  normalMap: asset(`textures/${name}/normal.jpg`),
  armMap: asset(`textures/${name}/arm.jpg`),
});

export const SKY = {
  dry: asset("sky/kloofendal_48d_partly_cloudy_puresky_1k.hdr"),
  wet: asset("sky/kloofendal_overcast_puresky_1k.hdr"),
};

export const KENNEY = (name: string) => asset(`environment/kenney-racing-kit/${name}.glb`);
export const CAR_MODEL = (name: string) => asset(`cars/${name}.glb`);
export const CHARACTER = (name: string) => asset(`characters/${name}.glb`);
export const OLD_TYRE = asset("environment/old_tyre/old_tyre_1k.gltf");
export const F1_MODEL = (lod: "hi" | "lo") => asset(`cars/f1/f1_${lod}.glb`);
