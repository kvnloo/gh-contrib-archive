import * as THREE from "three";
import { glowTexture, patchInstancedGlow } from "./materials";
import { makeRng, terrainHeight } from "./terrain";

/** Optional gill/rib emissive map shared by every fruiting body. */
let gillMap: THREE.Texture | null = null;
export function setGillMap(tex: THREE.Texture) {
  gillMap = tex;
}

/** Bell-shaped cap with a slight lip, like the target's glowing fungi. */
export function capGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = Math.pow(Math.sin(t * Math.PI * 0.5), 0.85) * 0.5;
    const y = 0.42 * Math.cos(t * Math.PI * 0.5) * (1 - 0.15 * t);
    pts.push(new THREE.Vector2(r, y));
  }
  pts.push(new THREE.Vector2(0.47, -0.09));
  pts.push(new THREE.Vector2(0.33, -0.14));
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.computeVertexNormals();
  return geo;
}

/** Slender, slightly swollen stem rooted below the cap origin. */
export function stemGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -0.95 + t * 0.95;
    const r = 0.085 - 0.035 * t + 0.022 * Math.sin(t * 3.1) + 0.03 * Math.pow(1 - t, 3);
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, 12);
  geo.computeVertexNormals();
  return geo;
}

export type MushroomField = {
  group: THREE.Group;
  caps: THREE.InstancedMesh;
  capMaterial: THREE.MeshStandardMaterial;
  stemMaterial: THREE.MeshStandardMaterial;
  /** Instance index -> index into the source item list (public field only). */
  instanceToItem: number[];
  positions: THREE.Vector3[];
  scales: number[];
};

export type Placement = { x: number; z: number; scale: number; itemIndex: number };

/**
 * Builds one instanced mushroom colony (caps + stems + additive haloes).
 * `bright` colonies are the public, clickable ones; dim colonies stand in for
 * private work, which carries no identifying data at all.
 */
export function buildMushrooms(
  placements: Placement[],
  uniforms: { uTime: { value: number } },
  opts: {
    bright: boolean;
    seed: number;
    haloScale?: number;
  },
): MushroomField {
  const group = new THREE.Group();
  const rng = makeRng(opts.seed);
  const count = placements.length;

  const capMaterial = new THREE.MeshStandardMaterial({
    // The caps are pale, waxy flesh that also glows. Painting them near-black
    // and relying on emissive alone is what turns a colony into featureless
    // sparks: the body needs to catch the surrounding light too.
    color: opts.bright ? 0x27423d : 0x111e1c,
    emissive: opts.bright ? 0xbdfff0 : 0x1c4b45,
    emissiveIntensity: opts.bright ? 0.7 : 0.22,
    emissiveMap: gillMap ?? undefined,
    roughness: 0.28,
    metalness: 0.0,
  });
  patchInstancedGlow(capMaterial, uniforms, {
    amount: opts.bright ? 0.3 : 0.18,
    speed: 1.25,
    gills: 1.6,
    rim: 1.1,
  });

  const stemMaterial = new THREE.MeshStandardMaterial({
    color: opts.bright ? 0x1a2b28 : 0x0c1513,
    emissive: opts.bright ? 0x2fbfa6 : 0x0d2b27,
    emissiveIntensity: opts.bright ? 0.32 : 0.1,
    roughness: 0.5,
    metalness: 0.0,
  });
  patchInstancedGlow(stemMaterial, uniforms, { amount: 0.2, speed: 1.05, rim: 0.9 });

  const capGeo = capGeometry();
  const stemGeo = stemGeometry();

  const caps = new THREE.InstancedMesh(capGeo, capMaterial, Math.max(count, 1));
  const stems = new THREE.InstancedMesh(stemGeo, stemMaterial, Math.max(count, 1));
  caps.frustumCulled = false;
  stems.frustumCulled = false;

  const seeds = new Float32Array(Math.max(count, 1));
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scaleV = new THREE.Vector3();
  const posV = new THREE.Vector3();

  const instanceToItem: number[] = [];
  const positions: THREE.Vector3[] = [];
  const scales: number[] = [];
  const haloPositions: number[] = [];

  placements.forEach((p, i) => {
    const ground = terrainHeight(p.x, p.z);
    const y = ground + p.scale * 0.93;
    posV.set(p.x, y, p.z);
    // Mushrooms lean away from the stream, following the slope.
    euler.set((rng() - 0.5) * 0.32, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
    quat.setFromEuler(euler);
    scaleV.setScalar(p.scale);
    matrix.compose(posV, quat, scaleV);
    caps.setMatrixAt(i, matrix);
    stems.setMatrixAt(i, matrix);
    seeds[i] = rng();
    instanceToItem.push(p.itemIndex);
    positions.push(posV.clone());
    scales.push(p.scale);
    haloPositions.push(posV.x, posV.y + p.scale * 0.12, posV.z);
  });

  capGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  stemGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds.slice(), 1));
  caps.instanceMatrix.needsUpdate = true;
  stems.instanceMatrix.needsUpdate = true;
  group.add(caps, stems);

  if (count > 0) {
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute("position", new THREE.Float32BufferAttribute(haloPositions, 3));
    const halo = new THREE.Points(
      haloGeo,
      new THREE.PointsMaterial({
        map: glowTexture(),
        color: opts.bright ? 0x8ff2e0 : 0x1f5a52,
        // Haloes sell "this thing is emitting light"; anything larger than the
        // cap itself just becomes additive fog once bloom gets hold of it.
        size: (opts.haloScale ?? 1) * (opts.bright ? 0.42 : 0.24),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        opacity: opts.bright ? 0.22 : 0.1,
      }),
    );
    group.add(halo);
  }

  return { group, caps, capMaterial, stemMaterial, instanceToItem, positions, scales };
}

/**
 * A single oversized hero mushroom for the foreground edges, with real
 * geometry (not instanced) so it can carry its own light.
 */
export function buildHeroMushroom(
  x: number,
  z: number,
  scale: number,
  uniforms: { uTime: { value: number } },
): { group: THREE.Group; light: THREE.PointLight } {
  const group = new THREE.Group();
  const ground = terrainHeight(x, z);
  group.position.set(x, ground + scale * 0.93, z);

  // Derive orientation from placement rather than runtime randomness so the
  // same public snapshot produces the same scene in screenshots and replays.
  const seed =
    ((Math.round((x + 64) * 1000) * 73856093) ^
      (Math.round((z + 128) * 1000) * 19349663) ^
      (Math.round(scale * 1000) * 83492791)) >>>
    0;
  const rng = makeRng(seed);
  group.rotation.set((rng() - 0.5) * 0.2, rng() * Math.PI, (rng() - 0.5) * 0.22);
  group.scale.setScalar(scale);

  // Foreground heroes are read mostly as silhouette: a dark, damp cap crown
  // with light pouring out of the gills onto the ground beneath.
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x2d4a45,
    emissive: 0xd6fff5,
    emissiveIntensity: 0.85,
    emissiveMap: gillMap ?? undefined,
    roughness: 0.24,
    metalness: 0.05,
  });
  patchInstancedGlow(capMat, uniforms, { amount: 0.2, speed: 0.9, gills: 1.9, rim: 1.3 });
  const cap = new THREE.Mesh(capGeometry(), capMat);
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0x1d2f2c,
    emissive: 0x4fd8be,
    emissiveIntensity: 0.42,
    roughness: 0.45,
  });
  patchInstancedGlow(stemMat, uniforms, { amount: 0.14, speed: 0.8, rim: 1.0 });
  const stem = new THREE.Mesh(stemGeometry(), stemMat);
  group.add(cap, stem);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0x9df3e2,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.2,
    }),
  );
  halo.scale.setScalar(1.15);
  halo.position.set(0, -0.08, 0);
  group.add(halo);

  // Sits just under the cap so the gill light spills onto the ground below.
  const light = new THREE.PointLight(0x7effe4, 150 * scale * scale, 14 * scale, 2);
  light.position.set(0, -0.25, 0);
  group.add(light);

  return { group, light };
}
