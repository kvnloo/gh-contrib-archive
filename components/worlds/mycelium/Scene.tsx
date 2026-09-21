"use client";

import { WorldChrome } from "@/components/worlds/WorldChrome";
import { useWorldGraph, type Graph } from "@/components/worlds/useWorldGraph";
import { publicAssetPath } from "@/lib/public-path";
import { isVisualVerifyMode } from "@/components/worlds/visualVerify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

import { GradeShader } from "./GradeShader";
import { buildCanopy, buildVault } from "./canopy";
import { buildCity } from "./city";
import {
  FOG_COLOR,
  FOG_DENSITY,
  glowTexture,
  loadTiling,
  moteTexture,
  patchWetGround,
} from "./materials";
import { buildHeroMushroom, buildMushrooms, setGillMap, type Placement } from "./props";
import {
  WATER_LEVEL,
  makeRng,
  streamCenter,
  terrainHeight,
} from "./terrain";
import { createStream } from "./water";

type GraphNode = {
  id: string;
  type: string;
  visibility: string;
  url?: string;
  repo?: string;
  number?: number;
  title?: string;
  flags?: string[];
  created?: string;
};

/** Only ever built from public nodes — private work never gets a label. */
type PublicItem = {
  id: string;
  title: string;
  repo: string;
  number?: number;
  url?: string;
  kind: string;
};

const TEX = publicAssetPath("/textures/mycelium");

function isItem(n: GraphNode) {
  return n.type === "issue" || n.type === "pull_request";
}

/**
 * Colonies of fruiting bodies climbing both banks and receding into the
 * cavern. Public items land on the near, brightly lit banks; private items are
 * pushed into the far haze as unnamed, dim growth.
 */
function layOutColonies(
  count: number,
  seed: number,
  opts: { zNear: number; zFar: number; bright: boolean },
): Placement[] {
  const rng = makeRng(seed);
  const placements: Placement[] = [];
  // Many small colonies rather than a few big ones: the target reads as dozens
  // of separate clumps tracing the water's edge into the distance.
  const clusters = Math.max(1, Math.round(count / 6));

  for (let c = 0; c < clusters; c++) {
    const t = clusters === 1 ? 0.4 : c / (clusters - 1);
    const z = opts.zNear + (opts.zFar - opts.zNear) * (t + (rng() - 0.5) * 0.08);
    const side = c % 2 === 0 ? 1 : -1;
    // Fruiting bodies hug the damp channel edge and thin out up the dry banks.
    const cx = streamCenter(z) + side * (2.0 + Math.pow(rng(), 1.8) * 5.5);
    const members = Math.min(count - placements.length, 4 + Math.floor(rng() * 8));
    for (let i = 0; i < members; i++) {
      const x = cx + (rng() - 0.5) * 2.4;
      const pz = z + (rng() - 0.5) * 3.2;
      // Nearer growth reads bigger; far growth stays small so scale sells depth.
      const depth = THREE.MathUtils.clamp((24 - pz) / 70, 0, 1);
      const scale = (opts.bright ? 0.3 : 0.22) * (1.35 - depth * 0.5) * (0.5 + rng() * 1.2);
      placements.push({ x, z: pz, scale, itemIndex: placements.length });
    }
    if (placements.length >= count) break;
  }
  return placements.slice(0, count);
}

function buildTerrain(
  soil: THREE.Texture,
  bump: THREE.Texture,
  uniforms: { uTime: { value: number } },
): THREE.Mesh {
  const width = 150;
  const depth = 200;
  const centerZ = -66;
  const geo = new THREE.PlaneGeometry(width, depth, 300, 380);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wz = -pos.getY(i) + centerZ;
    const h = terrainHeight(wx, wz);
    pos.setZ(i, h);

    // The cavern floor is near-black wet earth. It only ever brightens where a
    // colony is standing on it, so the base albedo stays deep and slightly warm
    // (soil brown) to contrast against the cold bioluminescence.
    const above = THREE.MathUtils.clamp((h - WATER_LEVEL) / 4.5, 0, 1);
    const silt = THREE.MathUtils.clamp(1 - above * 1.4, 0, 1);
    color.setRGB(0.42 + above * 0.24, 0.35 + above * 0.2, 0.28 + above * 0.18);
    // Silt in the channel is cooler and darker than the dry uplands.
    color.lerp(new THREE.Color(0.2, 0.26, 0.27), silt * 0.7);
    color.multiplyScalar(0.62 + above * 0.44);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: soil,
    bumpMap: bump,
    bumpScale: 1.6,
    roughnessMap: bump,
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.03,
  });
  patchWetGround(material, WATER_LEVEL, uniforms);

  const mesh = new THREE.Mesh(geo, material);
  // Heights were sampled in world space, so the mesh must sit at that offset.
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.z = centerZ;
  return mesh;
}

type Filament = {
  curve: THREE.CatmullRomCurve3;
  offset: number;
  speed: number;
};

/**
 * Ground-level hyphae: glowing threads knitting the colonies together, with
 * nutrient packets travelling along them.
 */
function buildFilaments(
  points: THREE.Vector3[],
  seed: number,
): { group: THREE.Group; filaments: Filament[]; packets: THREE.Points } {
  const group = new THREE.Group();
  const rng = makeRng(seed);
  const filaments: Filament[] = [];

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0x3fc9b2,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const maxLinks = 320;
  for (let i = 0; i < points.length && filaments.length < maxLinks; i++) {
    const a = points[i];
    // Link to a handful of nearby colonies to build a web, not a starburst.
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < points.length; k++) {
      if (k === i) continue;
      const d = a.distanceToSquared(points[k]);
      if (d < bestD && d > 0.8) {
        bestD = d;
        best = k;
      }
    }
    if (best < 0) continue;
    const b = points[best];
    if (a.distanceTo(b) > 14) continue;

    const mid = a.clone().lerp(b, 0.5);
    mid.y = Math.max(terrainHeight(mid.x, mid.z), WATER_LEVEL) + 0.15 + rng() * 0.5;
    const q1 = a.clone().lerp(mid, 0.5);
    q1.y = Math.max(terrainHeight(q1.x, q1.z), WATER_LEVEL) + 0.1 + rng() * 0.3;
    const q2 = mid.clone().lerp(b, 0.5);
    q2.y = Math.max(terrainHeight(q2.x, q2.z), WATER_LEVEL) + 0.1 + rng() * 0.3;

    const curve = new THREE.CatmullRomCurve3([
      a.clone().setY(a.y - 0.35),
      q1,
      mid,
      q2,
      b.clone().setY(b.y - 0.35),
    ]);
    const tube = new THREE.TubeGeometry(curve, 28, 0.009 + rng() * 0.016, 5, false);
    group.add(new THREE.Mesh(tube, coreMat));
    filaments.push({ curve, offset: rng(), speed: 0.05 + rng() * 0.09 });
  }

  const packetCount = filaments.length * 2;
  const packetGeo = new THREE.BufferGeometry();
  packetGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(Math.max(packetCount, 1) * 3), 3),
  );
  const packets = new THREE.Points(
    packetGeo,
    new THREE.PointsMaterial({
      map: moteTexture(),
      color: 0xdfffff,
      size: 0.07,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      opacity: 0.55,
    }),
  );
  group.add(packets);

  return { group, filaments, packets };
}

function buildSpores(count: number, seed: number): THREE.Points {
  const rng = makeRng(seed);
  const positions = new Float32Array(count * 3);
  const drift = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = (rng() - 0.5) * 90;
    const z = 22 - rng() * 120;
    positions[i * 3] = x;
    positions[i * 3 + 1] = terrainHeight(x, z) + rng() * 16;
    positions[i * 3 + 2] = z;
    drift[i * 3] = (rng() - 0.5) * 0.25;
    drift[i * 3 + 1] = 0.06 + rng() * 0.3;
    drift[i * 3 + 2] = (rng() - 0.5) * 0.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("aDrift", new THREE.Float32BufferAttribute(drift, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: moteTexture(),
      color: 0xa9ffe8,
      size: 0.055,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      // Airborne spores are a garnish. At high count and opacity they become a
      // uniform sparkle veil over the whole frame and destroy the read of depth.
      opacity: 0.2,
    }),
  );
}

/** Wet stones breaking the surface of the stream, plus their glints. */
function buildStreamDetail(
  soil: THREE.Texture,
  bump: THREE.Texture,
  uniforms: { uTime: { value: number } },
): THREE.Group {
  const group = new THREE.Group();
  const rng = makeRng(0x3f19cd);

  const stoneMat = new THREE.MeshStandardMaterial({
    map: soil,
    bumpMap: bump,
    bumpScale: 0.6,
    color: 0x6b6560,
    roughness: 0.42,
    metalness: 0.12,
  });
  patchWetGround(stoneMat, WATER_LEVEL, uniforms);

  for (let i = 0; i < 90; i++) {
    const z = 20 - rng() * 90;
    const x = streamCenter(z) + (rng() - 0.5) * 7;
    const s = 0.1 + rng() * 0.5;
    const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), stoneMat);
    stone.position.set(x, WATER_LEVEL - s * 0.35 + rng() * 0.12, z);
    stone.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    stone.scale.set(1, 0.55 + rng() * 0.4, 1);
    group.add(stone);
  }

  // Glints sitting on the water: read as specular sparkle and get mirrored.
  const glintMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0xcaffef,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.28,
  });
  // Small and numerous: specular sparkle scattered over the water surface,
  // each one small enough to stay a point rather than a patch of haze.
  for (let i = 0; i < 70; i++) {
    const z = 18 - rng() * 84;
    const glint = new THREE.Sprite(glintMat);
    glint.position.set(streamCenter(z) + (rng() - 0.5) * 4.2, WATER_LEVEL + 0.03, z);
    glint.scale.setScalar(0.05 + rng() * 0.22);
    group.add(glint);
  }

  // The warm heart of the cavern that the target still centres the frame on.
  const emberMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0xffb070,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.4,
  });
  // A tight warm core, not a broad wash: in the target this is a single small
  // amber point deep in the channel that the whole cold frame reads against.
  for (let i = 0; i < 3; i++) {
    const z = -26 - i * 7;
    const ember = new THREE.Sprite(emberMat);
    ember.position.set(streamCenter(z), WATER_LEVEL + 0.35 + i * 0.3, z);
    ember.scale.setScalar(0.7 + i * 0.45);
    group.add(ember);
  }

  return group;
}

type Tooltip = { x: number; y: number; item: PublicItem } | null;

function MyceliumCanvas({ graph }: { graph: Graph }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playingRef = useRef(true);
  const [playing, setPlaying] = useState(true);
  const [fps, setFps] = useState(60);
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const [autoCam, setAutoCam] = useState(true);
  const autoCamRef = useRef(true);

  const stats = useMemo(() => {
    const nodes = graph.nodes as GraphNode[];
    let pub = 0;
    let priv = 0;
    for (const n of nodes) {
      if (!isItem(n)) continue;
      if (n.visibility === "public") pub++;
      else priv++;
    }
    return { pub, priv, repos: graph.repos?.length ?? 0 };
  }, [graph]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      playingRef.current = !p;
      return !p;
    });
  }, []);

  const recenter = useCallback(() => {
    autoCamRef.current = true;
    setAutoCam(true);
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const verifyMode = isVisualVerifyMode();
    if (verifyMode) {
      playingRef.current = false;
      autoCamRef.current = false;
    }

    const nodes = graph.nodes as GraphNode[];
    const publicItems: PublicItem[] = nodes
      .filter((n) => isItem(n) && n.visibility === "public")
      .map((n) => ({
        id: n.id,
        title: n.title ?? "",
        repo: n.repo ?? "",
        number: n.number,
        url: n.url,
        kind: n.type === "pull_request" ? "pull request" : "issue",
      }));
    const privateCount = nodes.filter((n) => isItem(n) && n.visibility !== "public").length;

    const uniforms = { uTime: { value: 0 } };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010405);
    scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

    // Wide and low, crouched just above the waterline so the stream leads the
    // eye down the channel to the distant spires, with the banks and canopy
    // closing in as dark framing mass.
    const camera = new THREE.PerspectiveCamera(
      56,
      container.clientWidth / container.clientHeight,
      0.05,
      400,
    );
    const camHome = new THREE.Vector3(0.4, -0.45, 14.5);
    const camTarget = new THREE.Vector3(streamCenter(-26), 3.4, -28);
    camera.position.copy(camHome);
    camera.lookAt(camTarget);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    // Tone mapping is deliberately deferred to GradeShader so the bloom pass
    // sees real linear HDR and the ACES curve is only ever applied once.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Threshold well above the ambient level: only genuine emitters halate, so
    // the dark 90% of the frame is left alone instead of being lifted into fog.
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.4,
      0.45,
      0.88,
    );
    composer.addPass(bloom);
    const grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minPolarAngle = Math.PI * 0.22;
    controls.maxPolarAngle = Math.PI * 0.56;
    controls.minDistance = 3;
    controls.maxDistance = 70;
    controls.target.copy(camTarget);
    controls.addEventListener("start", () => {
      autoCamRef.current = false;
      setAutoCam(false);
    });

    const loader = new THREE.TextureLoader();
    const soil = loadTiling(loader, `${TEX}/soil-albedo.png`, 30, true);
    const soilBump = loadTiling(loader, `${TEX}/soil-bump.png`, 30, false);
    const bark = loadTiling(loader, `${TEX}/root-bark.png`, 6, true);
    const barkBump = loadTiling(loader, `${TEX}/soil-bump.png`, 6, false);
    const web = loadTiling(loader, `${TEX}/hyphae-web.png`, 3, true);
    const waterDudv = loadTiling(loader, `${TEX}/water-normal.png`, 1, false);
    const membrane = loadTiling(loader, `${TEX}/membrane-web.png`, 1, true);
    const membraneAlpha = loadTiling(loader, `${TEX}/membrane-alpha.png`, 1, false);
    const vaultRock = loadTiling(loader, `${TEX}/vault-rock.png`, 14, true);
    const vaultBump = loadTiling(loader, `${TEX}/vault-bump.png`, 14, false);
    const gills = loadTiling(loader, `${TEX}/cap-gills.png`, 1, true);
    // Lathe UVs run u around the circumference, so repeating u lays the ribs
    // out radially across every cap.
    gills.repeat.set(7, 1);
    setGillMap(gills);

    const ground = buildTerrain(soil, soilBump, uniforms);
    scene.add(ground);

    scene.add(buildVault(vaultRock, vaultBump));

    const water = createStream(
      11,
      190,
      waterDudv,
      uniforms,
      Math.min(1024, Math.max(512, Math.round(container.clientWidth))),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, WATER_LEVEL, -66);
    scene.add(water);

    scene.add(buildStreamDetail(soil, soilBump, uniforms));

    const canopy = buildCanopy({ bark, barkBump, web, membrane, membraneAlpha });
    scene.add(canopy.group);
    const membraneBase = canopy.membraneMaterials.map((m) => m.emissiveIntensity);

    const cityWeights = (graph.repos ?? [])
      .map((r) => r.n)
      .slice(0, 40);
    const maxW = Math.max(1, ...cityWeights);
    const city = buildCity(
      cityWeights.length ? cityWeights.map((n) => 0.25 + (n / maxW) * 0.75) : [0.5],
      uniforms,
    );
    scene.add(city.group);

    // Public colonies: clickable, titled. Private colonies: dim, anonymous.
    const publicPlacements = layOutColonies(Math.min(publicItems.length, 260), 0x1234abcd, {
      zNear: 18,
      zFar: -44,
      bright: true,
    });
    const publicField = buildMushrooms(publicPlacements, uniforms, {
      bright: true,
      seed: 0x77aa11,
    });
    scene.add(publicField.group);

    const privatePlacements = layOutColonies(Math.min(privateCount, 320), 0xfeed5eed, {
      zNear: -18,
      zFar: -92,
      bright: false,
    });
    const privateField = buildMushrooms(privatePlacements, uniforms, {
      bright: false,
      seed: 0x22bb99,
      haloScale: 0.8,
    });
    scene.add(privateField.group);

    // Foreground heroes sit at the frame edges as scale references, mirroring
    // the target's big caps in the lower-left and right corners.
    const heroes = [
      buildHeroMushroom(-6.4, 12.8, 1.35, uniforms),
      buildHeroMushroom(-8.8, 8.4, 1.0, uniforms),
      buildHeroMushroom(7.2, 12.0, 1.2, uniforms),
      buildHeroMushroom(9.6, 6.8, 0.85, uniforms),
      buildHeroMushroom(-4.2, 16.5, 0.75, uniforms),
    ];
    for (const hero of heroes) scene.add(hero.group);
    const heroBase = heroes.map((h) => h.light.intensity);

    const { group: filamentGroup, filaments, packets } = buildFilaments(
      publicField.positions.concat(privateField.positions.slice(0, 60)),
      0x5150ab,
    );
    scene.add(filamentGroup);

    const spores = buildSpores(520, 0xabcdef);
    scene.add(spores);

    // A cave has no skylight, but a cave full of bioluminescence has a huge
    // amount of bounced light. Without it the 5%-albedo earth renders as pure
    // black and the whole frame collapses to the additive emitters alone, which
    // is exactly the "cyan sparks on nothing" failure. Ambient plus two soft
    // directionals stand in for that global bounce; the local point lights below
    // still supply the pools of falloff that carry depth.
    scene.add(new THREE.AmbientLight(0x0e2b28, 1.5));
    scene.add(new THREE.HemisphereLight(0x14403a, 0x0a1210, 1.1));

    // Fill from the distant city, straight down the ravine: this is what puts a
    // readable teal edge on the banks, roots and canopy and separates the layers.
    const cityFill = new THREE.DirectionalLight(0x63e8d0, 0.9);
    cityFill.position.set(2, 16, -80);
    cityFill.target.position.set(0, 0, 0);
    scene.add(cityFill, cityFill.target);

    // Grazing side fill so the near banks show their bump detail instead of
    // reading as flat silhouettes.
    const bankFill = new THREE.DirectionalLight(0x2f7f74, 0.55);
    bankFill.position.set(-18, 9, 12);
    scene.add(bankFill);

    // Warm counter-fill from the ember heart, cheating some of its bounce into
    // the foreground earth so the frame is not a single hue.
    const emberFill = new THREE.DirectionalLight(0xffa464, 0.28);
    emberFill.position.set(0, 3, -30);
    scene.add(emberFill);

    // Every light below is in candela with inverse-square decay, so the numbers
    // look large: a fungus lighting damp 5%-albedo soil a few metres away needs
    // real intensity to register at all. The steep falloff is the point — it is
    // what carves discrete pools of lit earth out of the dark.
    const cityGlow = new THREE.PointLight(0x4fe0c8, 2800, 320, 2);
    cityGlow.position.set(3, 22, -92);
    scene.add(cityGlow);

    const warmCore = new THREE.PointLight(0xffa860, 520, 60, 2);
    warmCore.position.set(streamCenter(-30), 0.6, -30);
    scene.add(warmCore);

    // Bounce off the wet channel, lighting the undersides of the near banks.
    const waterBounce = new THREE.PointLight(0x2ee6c8, 340, 30, 2);
    waterBounce.position.set(streamCenter(-6), 0.1, -6);
    scene.add(waterBounce);

    // A second bounce right under the camera: the target's lower third is lit
    // wet earth with specular sheen, not a black mask.
    const nearBounce = new THREE.PointLight(0x36e0c4, 220, 22, 2);
    nearBounce.position.set(streamCenter(8), WATER_LEVEL + 1.0, 8);
    scene.add(nearBounce);

    // Pools of colony light along the banks, each carving a bright patch of wet
    // earth out of the dark and going black again between colonies.
    const colonyLights: THREE.PointLight[] = [];
    const colonySpots: [number, number, number][] = [
      [-6.5, 6, 1.0],
      [7.2, -2, 0.9],
      [-9.0, -14, 0.8],
      [9.5, -22, 0.75],
      [-5.0, -34, 0.7],
      [4.0, 9, 0.8],
      [-11.0, 14, 0.7],
      [11.0, 16, 0.65],
      [6.0, -44, 0.6],
      [-8.0, -54, 0.5],
    ];
    for (const [x, z, power] of colonySpots) {
      const light = new THREE.PointLight(0x62f0d8, 460 * power, 26, 2);
      light.position.set(x, terrainHeight(x, z) + 1.2, z);
      scene.add(light);
      colonyLights.push(light);
    }
    const colonyBase = colonyLights.map((l) => l.intensity);

    // Interaction: hover/click on public fruiting bodies only.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoverIndex = -1;

    const pickAt = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(publicField.caps, false);
      if (!hits.length || hits[0].instanceId == null) return -1;
      return publicField.instanceToItem[hits[0].instanceId] ?? -1;
    };

    const onMove = (e: PointerEvent) => {
      const idx = pickAt(e.clientX, e.clientY);
      if (idx === hoverIndex) {
        if (idx >= 0) {
          setTooltip((prev) =>
            prev ? { ...prev, x: e.clientX, y: e.clientY } : prev,
          );
        }
        return;
      }
      hoverIndex = idx;
      const item = idx >= 0 ? publicItems[idx] : undefined;
      renderer.domElement.style.cursor = item?.url ? "pointer" : "default";
      setTooltip(item ? { x: e.clientX, y: e.clientY, item } : null);
    };

    const onLeave = () => {
      hoverIndex = -1;
      setTooltip(null);
    };

    const onClick = (e: MouseEvent) => {
      const idx = pickAt(e.clientX, e.clientY);
      const url = idx >= 0 ? publicItems[idx]?.url : undefined;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    };

    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("click", onClick);

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloom.resolution.set(w, h);
    };
    window.addEventListener("resize", onResize);

    const packetPos = packets.geometry.attributes.position as THREE.BufferAttribute;
    const sporePos = spores.geometry.attributes.position as THREE.BufferAttribute;
    const sporeDrift = spores.geometry.attributes.aDrift as THREE.BufferAttribute;

    let raf = 0;
    let lastFps = performance.now();
    let fpsFrames = 0;
    let flowTime = 0;
    const clock = new THREE.Clock();
    const tmp = new THREE.Vector3();

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = verifyMode ? 0 : Math.min(clock.getDelta(), 0.05);
      const t = verifyMode ? 0 : clock.elapsedTime;
      uniforms.uTime.value = t;
      grade.uniforms.uTime.value = t;
      if (!verifyMode && playingRef.current) flowTime += dt;

      // Nutrient packets crawling the hyphal network.
      for (let i = 0; i < filaments.length; i++) {
        const f = filaments[i];
        for (let k = 0; k < 2; k++) {
          const u = (flowTime * f.speed + f.offset + k * 0.5) % 1;
          f.curve.getPoint(u, tmp);
          const idx = i * 2 + k;
          if (idx * 3 + 2 < packetPos.array.length) {
            packetPos.setXYZ(idx, tmp.x, tmp.y + 0.04, tmp.z);
          }
        }
      }
      packetPos.needsUpdate = true;

      // Spores rising through the shafts of light.
      if (!verifyMode && playingRef.current) {
        for (let i = 0; i < sporePos.count; i++) {
          let y = sporePos.getY(i) + sporeDrift.getY(i) * dt;
          const x = sporePos.getX(i) + Math.sin(t * 0.3 + i) * sporeDrift.getX(i) * dt;
          const z = sporePos.getZ(i) + sporeDrift.getZ(i) * dt;
          if (y > 22) y = terrainHeight(x, z) - 0.5;
          sporePos.setXYZ(i, x, y, z);
        }
        sporePos.needsUpdate = true;
      }

      // Membranes breathe, so the canopy never looks like static decals. The
      // web texture is shared, so only per-material state is animated here.
      canopy.webMaterials.forEach((m, i) => {
        m.opacity = (0.05 + (i % 3) * 0.012) * (0.85 + 0.15 * Math.sin(t * 0.5 + i));
      });

      // Bioluminescence creeping through the lace at different rates per sheet.
      canopy.membraneMaterials.forEach((m, i) => {
        m.emissiveIntensity = membraneBase[i] * (0.78 + 0.22 * Math.sin(t * 0.33 + i * 1.9));
      });

      heroes.forEach((hero, i) => {
        hero.light.intensity = heroBase[i] * (0.85 + 0.15 * Math.sin(t * 0.9 + i * 2));
      });
      warmCore.intensity = 520 * (0.9 + 0.1 * Math.sin(t * 0.7));
      colonyLights.forEach((light, i) => {
        // Colonies pulse out of phase, so the banks never look statically lit.
        light.intensity = colonyBase[i] * (0.78 + 0.22 * Math.sin(t * 0.6 + i * 1.7));
      });

      if (!verifyMode && autoCamRef.current) {
        // Slow handheld drift down the ravine.
        const breath = Math.sin(t * 0.11);
        camera.position.set(
          camHome.x + Math.sin(t * 0.075) * 1.5,
          camHome.y + Math.sin(t * 0.052) * 0.22,
          camHome.z - (1 - Math.cos(t * 0.038)) * 3.6,
        );
        controls.target.set(
          camTarget.x + breath * 0.9,
          camTarget.y + Math.sin(t * 0.09) * 0.28,
          camTarget.z,
        );
      }

      controls.update();
      composer.render();

      fpsFrames++;
      const now = performance.now();
      if (now - lastFps > 500) {
        setFps(Math.round((fpsFrames * 1000) / (now - lastFps)));
        fpsFrames = 0;
        lastFps = now;
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      water.dispose();
      composer.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      for (const tex of [
        soil,
        soilBump,
        bark,
        barkBump,
        web,
        waterDudv,
        membrane,
        membraneAlpha,
        vaultRock,
        vaultBump,
        gills,
      ]) {
        tex.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [graph]);

  return (
    <>
      <div ref={mountRef} className="absolute inset-0" />

      {tooltip ? (
        <div
          className="pointer-events-none fixed z-30 max-w-xs -translate-y-full rounded-md border border-teal-400/25 bg-black/70 px-3 py-2 backdrop-blur"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <p className="text-[10px] uppercase tracking-[0.2em] text-teal-300/80">
            {tooltip.item.kind}
            {tooltip.item.number != null ? ` #${tooltip.item.number}` : ""}
          </p>
          <p className="mt-1 text-xs leading-snug text-zinc-100">{tooltip.item.title}</p>
          {tooltip.item.repo ? (
            <p className="mt-1 text-[10px] text-zinc-400">{tooltip.item.repo}</p>
          ) : null}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="pointer-events-auto flex gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="rounded-full bg-black/50 px-4 py-2 text-xs uppercase tracking-wider text-teal-300 ring-1 ring-teal-500/40 backdrop-blur hover:bg-teal-950/60"
          >
            {playing ? "Pause flow" : "Resume flow"}
          </button>
          {!autoCam ? (
            <button
              type="button"
              onClick={recenter}
              className="rounded-full bg-black/50 px-4 py-2 text-xs uppercase tracking-wider text-teal-300 ring-1 ring-teal-500/40 backdrop-blur hover:bg-teal-950/60"
            >
              Resume drift
            </button>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            {stats.pub} public fruiting bodies · {stats.priv} private (counts only)
          </p>
          <p className="text-[10px] uppercase tracking-[0.25em] text-zinc-600">
            WebGL · {fps} FPS
          </p>
        </div>
      </div>
    </>
  );
}

export default function MyceliumScene() {
  const graph = useWorldGraph();
  return (
    <WorldChrome title="Mycelium">
      <div className="absolute inset-0 bg-[#02070a]">
        {graph ? (
          <MyceliumCanvas graph={graph} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Loading public-safe graph…
          </div>
        )}
      </div>
    </WorldChrome>
  );
}
