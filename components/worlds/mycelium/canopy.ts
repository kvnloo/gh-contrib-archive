import * as THREE from "three";
import { makeRng, terrainHeight } from "./terrain";

export type Canopy = {
  group: THREE.Group;
  webMaterials: THREE.MeshBasicMaterial[];
  membraneMaterials: THREE.MeshStandardMaterial[];
  webTexture: THREE.Texture;
};

export type CanopyTextures = {
  bark: THREE.Texture;
  barkBump: THREE.Texture;
  web: THREE.Texture;
  /** Lace albedo for the big hyphal sheets. */
  membrane: THREE.Texture;
  /** Luminance of `membrane`, used as its alpha so the holes are real. */
  membraneAlpha: THREE.Texture;
};

/**
 * Ceiling of the cavern: massive root arches spanning the frame, translucent
 * hyphal membranes stretched between them, and thin hanging filaments.
 */
export function buildCanopy(tex: CanopyTextures): Canopy {
  const { bark, barkBump, web, membrane, membraneAlpha } = tex;
  const group = new THREE.Group();
  const rng = makeRng(0x9a31bd);

  const rootMat = new THREE.MeshStandardMaterial({
    map: bark,
    bumpMap: barkBump,
    bumpScale: 0.55,
    emissiveMap: web,
    emissive: 0x2ad0b0,
    emissiveIntensity: 0.5,
    // Damp bark, not black plastic: it has to take the city fill and show its
    // bump detail, otherwise the arches read as flat holes in the frame.
    color: 0x2b241c,
    roughness: 0.72,
    metalness: 0.05,
  });

  const sheathMat = new THREE.MeshBasicMaterial({
    map: web,
    color: 0x3fbda8,
    transparent: true,
    opacity: 0.06,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  /**
   * The big lace sheets. These are lit geometry with a real alpha cutout rather
   * than additive cards: the strands catch light and the holes stay black, which
   * is what makes the webbing read as structure instead of haze.
   */
  const membraneBase = new THREE.MeshStandardMaterial({
    map: membrane,
    alphaMap: membraneAlpha,
    transparent: true,
    // Depth-written with a real cutout: overlapping sheets then occlude each
    // other properly instead of accumulating into a milky sheet.
    alphaTest: 0.14,
    depthWrite: true,
    side: THREE.DoubleSide,
    color: 0x354744,
    emissiveMap: membraneAlpha,
    emissive: 0x6ce8ce,
    emissiveIntensity: 0.5,
    roughness: 0.55,
    metalness: 0.0,
  });

  const archPaths: THREE.Vector3[][] = [
    [
      new THREE.Vector3(-30, 3, 16),
      new THREE.Vector3(-19, 11, 4),
      new THREE.Vector3(-4, 14.5, -8),
      new THREE.Vector3(14, 12, -14),
      new THREE.Vector3(30, 6, -6),
    ],
    [
      new THREE.Vector3(-34, 6, -2),
      new THREE.Vector3(-16, 15, -14),
      new THREE.Vector3(6, 17, -26),
      new THREE.Vector3(26, 13, -34),
    ],
    [
      new THREE.Vector3(32, 4, 14),
      new THREE.Vector3(20, 12, 2),
      new THREE.Vector3(4, 16, -4),
      new THREE.Vector3(-14, 13, -12),
      new THREE.Vector3(-30, 8, -20),
    ],
    [
      new THREE.Vector3(-26, 10, -30),
      new THREE.Vector3(-8, 19, -40),
      new THREE.Vector3(12, 20, -46),
      new THREE.Vector3(30, 15, -52),
    ],
  ];

  archPaths.forEach((path, i) => {
    const curve = new THREE.CatmullRomCurve3(path, false, "catmullrom", 0.4);
    const radius = 0.55 + rng() * 0.9 + (i === 0 ? 0.5 : 0);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, radius, 12, false), rootMat));
    group.add(
      new THREE.Mesh(new THREE.TubeGeometry(curve, 160, radius * 1.6, 10, false), sheathMat),
    );

    // Secondary roots braiding along each arch.
    for (let k = 0; k < 3; k++) {
      const offsetPath = path.map(
        (p, idx) =>
          new THREE.Vector3(
            p.x + (rng() - 0.5) * 3.2,
            p.y + (rng() - 0.5) * 2.0 - idx * 0.15,
            p.z + (rng() - 0.5) * 3.2,
          ),
      );
      const c = new THREE.CatmullRomCurve3(offsetPath, false, "catmullrom", 0.4);
      group.add(
        new THREE.Mesh(new THREE.TubeGeometry(c, 120, 0.1 + rng() * 0.22, 6, false), rootMat),
      );
    }
  });

  // Vertical root columns framing the left and right of the ravine.
  const columns: [number, number, number][] = [
    [-22, 18, 1.9],
    [-15, 12, 1.1],
    [24, 16, 1.5],
    [17, 10, 0.85],
    [-30, 14, 1.3],
    [32, 12, 1.0],
  ];
  for (const [x, top, r] of columns) {
    const z = -6 + rng() * 22 - 8;
    const base = terrainHeight(x, z);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, base - 0.4, z),
      new THREE.Vector3(x + (rng() - 0.5) * 2.5, base + top * 0.35, z + (rng() - 0.5) * 2.5),
      new THREE.Vector3(x + (rng() - 0.5) * 4, base + top * 0.72, z + (rng() - 0.5) * 3),
      new THREE.Vector3(x + (rng() - 0.5) * 5, base + top, z + (rng() - 0.5) * 4),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 90, r, 12, false), rootMat));
    group.add(
      new THREE.Mesh(new THREE.TubeGeometry(curve, 90, r * 1.35, 8, false), sheathMat),
    );
  }

  // Near-camera roots: heavy, out-of-focus masses that frame the left and
  // right edges and give the shot a foreground layer.
  const nearRoots: THREE.Vector3[][] = [
    [
      new THREE.Vector3(-16, -1.5, 24),
      new THREE.Vector3(-13, 4, 17),
      new THREE.Vector3(-11, 9, 9),
      new THREE.Vector3(-13, 12, 0),
    ],
    [
      new THREE.Vector3(-20, -1, 20),
      new THREE.Vector3(-15, 2.5, 14),
      new THREE.Vector3(-9.5, 4.5, 8),
      new THREE.Vector3(-7, 5.5, 1),
    ],
    [
      new THREE.Vector3(18, -1.5, 26),
      new THREE.Vector3(14, 5, 18),
      new THREE.Vector3(12, 10, 10),
      new THREE.Vector3(14, 13, 2),
    ],
  ];
  for (const path of nearRoots) {
    const curve = new THREE.CatmullRomCurve3(path, false, "catmullrom", 0.5);
    const r = 1.1 + rng() * 1.2;
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, r, 14, false), rootMat));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, r * 1.45, 10, false), sheathMat));
    for (let k = 0; k < 4; k++) {
      const braid = new THREE.CatmullRomCurve3(
        path.map(
          (p) =>
            new THREE.Vector3(
              p.x + (rng() - 0.5) * 2.6,
              p.y + (rng() - 0.5) * 1.6,
              p.z + (rng() - 0.5) * 2.2,
            ),
        ),
        false,
        "catmullrom",
        0.5,
      );
      group.add(
        new THREE.Mesh(new THREE.TubeGeometry(braid, 80, 0.06 + rng() * 0.3, 6, false), rootMat),
      );
    }
  }

  // Hyphal lace sheets slung between the arches and down the cavern walls.
  // x, y, z, width, height, texture repeat, emissive scale.
  const webMaterials: THREE.MeshBasicMaterial[] = [];
  const membraneMaterials: THREE.MeshStandardMaterial[] = [];
  const membraneSpots: [number, number, number, number, number, number, number][] = [
    // Upper-left curtain: the frame's biggest lace mass. Kept back from the
    // camera plane so it drapes into the corner instead of covering the lens.
    [-12.5, 6.5, 7.0, 14, 14, 1.4, 1.0],
    [-16.0, 10.5, 1.5, 18, 16, 1.7, 0.85],
    [-9.5, 12.0, 9.0, 12, 11, 1.2, 1.15],
    // Right-hand counterweight, thinner so the composition stays asymmetric.
    [15.0, 7.5, 6.0, 13, 12, 1.5, 0.7],
    [21.0, 11.0, -2.0, 20, 17, 2.1, 0.55],
    // Mid-ground sheets spanning the ravine, receding into the haze.
    [-22.0, 12.0, -6.0, 26, 20, 2.6, 0.6],
    [-26.0, 14.0, -20.0, 28, 22, 2.8, 0.45],
    [24.0, 13.0, -14.0, 26, 20, 2.6, 0.45],
    [-2.0, 17.5, -24.0, 40, 18, 3.4, 0.35],
    [-5.0, 15.0, 1.0, 32, 14, 3.0, 0.5],
  ];
  for (const [x, y, z, w, h, repeat, glow] of membraneSpots) {
    // The textures are shared and the per-sheet tiling is baked into the mesh
    // UVs below. Cloning a texture that is still loading would produce an empty
    // clone, because the clone only ever shares the image it had at clone time.
    const mat = membraneBase.clone();
    mat.map = membrane;
    mat.alphaMap = membraneAlpha;
    mat.emissiveMap = membraneAlpha;
    mat.emissiveIntensity = 0.5 * glow;
    membraneMaterials.push(mat);

    // Sag the sheet like real stretched silk: a shallow catenary in both axes
    // plus noise, so it never reads as a flat billboard.
    const geo = new THREE.PlaneGeometry(w, h, 30, 24);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / w;
      const v = pos.getY(i) / h;
      pos.setZ(
        i,
        (0.25 - u * u) * w * 0.22 +
          (0.25 - v * v) * h * 0.12 +
          Math.sin(u * 9.1 + rng() * 0.2) * 0.7 +
          (rng() - 0.5) * 0.5,
      );
    }
    geo.computeVertexNormals();

    // Per-sheet tiling and a random slice of the lace, baked into the UVs so
    // every sheet shows a different region of the same shared texture.
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const ou = rng();
    const ov = rng();
    const repeatV = repeat * (h / w);
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * repeat + ou, uv.getY(i) * repeatV + ov);
    }
    uv.needsUpdate = true;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(-0.3 + (rng() - 0.5) * 0.5, rng() * 0.7 - 0.35, rng() * 0.5 - 0.25);
    group.add(mesh);
  }

  // A faint additive sheath over the nearest lace so the strands halate very
  // slightly, the way bright silk does against a dark background.
  for (let i = 0; i < 3; i++) {
    const mat = sheathMat.clone();
    mat.map = web;
    mat.opacity = 0.05 + rng() * 0.05;
    webMaterials.push(mat);
    const geo = new THREE.PlaneGeometry(14, 13, 8, 8);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const ru = 2.0 + rng();
    const rv = 1.6 + rng();
    const ou = rng();
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, uv.getX(k) * ru + ou, uv.getY(k) * rv);
    }
    uv.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(-12.5 + i * 13.5, 7 + rng() * 3, 6.5 - i * 2);
    mesh.rotation.set(-0.3, rng() * 0.5 - 0.25, rng() * 0.3);
    group.add(mesh);
  }

  // Hanging filaments dripping from the arches.
  const dropMat = new THREE.MeshBasicMaterial({
    color: 0x2f8f7f,
    transparent: true,
    opacity: 0.13,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < 130; i++) {
    const x = -34 + rng() * 68;
    const z = -44 + rng() * 62;
    const top = 6 + rng() * 13;
    const len = 2 + rng() * 10;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, top, z),
      new THREE.Vector3(x + (rng() - 0.5) * 0.8, top - len * 0.5, z + (rng() - 0.5) * 0.8),
      new THREE.Vector3(x + (rng() - 0.5) * 1.4, top - len, z + (rng() - 0.5) * 1.4),
    ]);
    group.add(
      new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.012 + rng() * 0.03, 4, false), dropMat),
    );
  }

  return { group, webMaterials, membraneMaterials, webTexture: web };
}

/**
 * The rock shell the whole cavern sits inside: a vaulted ceiling and side walls
 * that recede down the ravine. Without it the upper frame is empty background
 * colour, which is what flattens the shot — the target's top third is dark,
 * textured rock with the arches silhouetted against it.
 */
export function buildVault(rock: THREE.Texture, rockBump: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const rng = makeRng(0x7c41e9);

  const rockMat = new THREE.MeshStandardMaterial({
    map: rock,
    bumpMap: rockBump,
    bumpScale: 2.4,
    roughnessMap: rockBump,
    color: 0x1b2422,
    roughness: 0.94,
    metalness: 0.04,
    side: THREE.BackSide,
  });

  // Open-ended half-cylinder arching over the ravine, with the far end left
  // open so the distant city still reads as "further away than the rock".
  // Rotated -90° about X below, which maps local +Y to world -Z (the ravine
  // axis) and local +Z to world +Y, so the open half must start at -90°.
  const vaultGeo = new THREE.CylinderGeometry(
    56,
    56,
    260,
    64,
    36,
    true,
    -Math.PI * 0.6,
    Math.PI * 1.2,
  );
  const vpos = vaultGeo.attributes.position;
  for (let i = 0; i < vpos.count; i++) {
    const x = vpos.getX(i);
    const y = vpos.getY(i);
    const z = vpos.getZ(i);
    // Lumpy, eroded rock rather than a perfect tube.
    const n =
      Math.sin(y * 0.07 + x * 0.05) * 3.2 +
      Math.cos(y * 0.031 + z * 0.09) * 4.1 +
      Math.sin(x * 0.13 + z * 0.11) * 1.8;
    const r = Math.hypot(x, z) || 1;
    vpos.setXYZ(i, (x / r) * (r + n), y, (z / r) * (r + n));
  }
  vaultGeo.computeVertexNormals();
  const vault = new THREE.Mesh(vaultGeo, rockMat);
  vault.rotation.x = -Math.PI / 2;
  vault.position.set(0, 4, -60);
  group.add(vault);

  // Ribs across the vault: the dark banding the target shows overhead.
  const ribMat = new THREE.MeshStandardMaterial({
    map: rock,
    bumpMap: rockBump,
    bumpScale: 1.2,
    color: 0x1d2624,
    roughness: 0.9,
    metalness: 0.03,
  });
  for (let i = 0; i < 11; i++) {
    const z = 10 - i * 13 - rng() * 4;
    const span = 30 + rng() * 12;
    const height = 15 + rng() * 9;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-span, 2 + rng() * 4, z),
      new THREE.Vector3(-span * 0.5, height * 0.8, z + (rng() - 0.5) * 6),
      new THREE.Vector3(0, height, z + (rng() - 0.5) * 6),
      new THREE.Vector3(span * 0.5, height * 0.82, z + (rng() - 0.5) * 6),
      new THREE.Vector3(span, 2 + rng() * 4, z),
    ]);
    const r = 0.7 + rng() * 1.6;
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, r, 9, false), ribMat));
  }

  return group;
}
