"use client";

import { WorldChrome } from "@/components/worlds/WorldChrome";
import { useWorldGraph, type Graph } from "@/components/worlds/useWorldGraph";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

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

const TEAL = 0x2ee6c8;
const TEAL_DIM = 0x0d4a42;
const SOIL = 0x0c0a08;
const HYPHAE_SEGMENTS = 28;

function busiestPublicRepo(nodes: GraphNode[]): string {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.visibility !== "public" || !n.repo) continue;
    if (n.type !== "issue" && n.type !== "pull_request") continue;
    counts.set(n.repo, (counts.get(n.repo) ?? 0) + 1);
  }
  let best = "";
  let max = 0;
  for (const [repo, count] of counts) {
    if (count > max) {
      max = count;
      best = repo;
    }
  }
  return best;
}

function computeLayout(graph: Graph): Map<string, THREE.Vector3> {
  const nodes = graph.nodes as GraphNode[];
  const positions = new Map<string, THREE.Vector3>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const hubRepo = busiestPublicRepo(nodes);

  const orbs = nodes.filter(
    (n) =>
      n.visibility === "public" &&
      (n.type === "issue" || n.type === "pull_request"),
  );
  const byRepo = new Map<string, GraphNode[]>();
  for (const n of orbs) {
    const repo = n.repo ?? "unknown";
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo)!.push(n);
  }

  const repos = [...byRepo.keys()].sort(
    (a, b) => (byRepo.get(b)?.length ?? 0) - (byRepo.get(a)?.length ?? 0),
  );
  let ring = 0;
  const ringStep = (Math.PI * 2) / Math.max(repos.length - 1, 1);

  for (const repo of repos) {
    const group = byRepo.get(repo)!;
    const fused = repo === hubRepo;
    const center = fused
      ? new THREE.Vector3(3, 1.2, 0)
      : new THREE.Vector3(
          Math.cos(ring) * 16,
          0.4 + Math.random() * 0.8,
          Math.sin(ring) * 12,
        );
    if (!fused) ring += ringStep;

    const spread = fused ? 5.5 : 2.8;
    group.forEach((n, i) => {
      const layer = Math.floor(i / 12);
      const t = (i % 12) / 12;
      const ang = t * Math.PI * 2 + layer * 0.7;
      const rad = spread * (0.25 + Math.random() * 0.75) * (fused ? 1 : 0.65);
      const y = center.y + (Math.random() - 0.5) * (fused ? 3.5 : 1.2) + layer * 0.35;
      positions.set(
        n.id,
        new THREE.Vector3(
          center.x + Math.cos(ang) * rad,
          y,
          center.z + Math.sin(ang) * rad,
        ),
      );
    });
  }

  const privateNodes = nodes.filter((n) => n.visibility === "private");
  privateNodes.forEach((n, i) => {
    const t = i / Math.max(privateNodes.length - 1, 1);
    positions.set(
      n.id,
      new THREE.Vector3(
        -10 - Math.random() * 6,
        0.6 + Math.random() * 2.5,
        (t - 0.5) * 28 + (Math.random() - 0.5) * 4,
      ),
    );
  });

  for (let pass = 0; pass < 8; pass++) {
    for (const edge of graph.edges) {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      const na = nodeById.get(edge.source);
      const nb = nodeById.get(edge.target);
      if (!na || !nb) continue;

      if (!positions.has(edge.target) && positions.has(edge.source)) {
        const src = positions.get(edge.source)!;
        positions.set(
          edge.target,
          src.clone().add(
            new THREE.Vector3(
              (Math.random() - 0.5) * 2.5,
              (Math.random() - 0.5) * 1.5,
              (Math.random() - 0.5) * 2.5,
            ),
          ),
        );
      }
      if (!positions.has(edge.source) && positions.has(edge.target)) {
        const tgt = positions.get(edge.target)!;
        positions.set(
          edge.source,
          tgt.clone().add(
            new THREE.Vector3(
              (Math.random() - 0.5) * 2.5,
              (Math.random() - 0.5) * 1.5,
              (Math.random() - 0.5) * 2.5,
            ),
          ),
        );
      }

      if (a && b && (edge.kind === "comment-on" || edge.kind === "citation")) {
        if (nb.type === "comment" || nb.type === "discussion_comment" || nb.type === "review_comment") {
          if (!positions.has(edge.target)) {
            positions.set(
              edge.target,
              a.clone().lerp(b, 0.35).add(new THREE.Vector3(0, 0.4, 0)),
            );
          }
        }
      }
    }
  }

  for (const n of nodes) {
    if (!positions.has(n.id)) {
      positions.set(
        n.id,
        new THREE.Vector3(
          (Math.random() - 0.5) * 20,
          Math.random() * 2,
          (Math.random() - 0.5) * 20,
        ),
      );
    }
  }

  return positions;
}

function hyphaCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.CatmullRomCurve3 {
  const mid = a.clone().lerp(b, 0.5);
  mid.y += 0.6 + Math.random() * 0.8;
  const c1 = a.clone().lerp(mid, 0.5);
  c1.x += (Math.random() - 0.5) * 1.2;
  c1.z += (Math.random() - 0.5) * 1.2;
  const c2 = mid.clone().lerp(b, 0.5);
  c2.x += (Math.random() - 0.5) * 1.2;
  c2.z += (Math.random() - 0.5) * 1.2;
  return new THREE.CatmullRomCurve3([a, c1, c2, b]);
}

function publicTags(n: GraphNode): string[] {
  const tags: string[] = [];
  if (n.type === "pull_request") tags.push("pull request");
  else if (n.type === "issue") tags.push("issue");
  for (const f of n.flags ?? []) {
    if (f === "agent_marker" || f === "machine_title") continue;
    tags.push(f.replace(/_/g, " "));
    if (tags.length >= 3) break;
  }
  return tags.slice(0, 3);
}

type Hypha = {
  curve: THREE.CatmullRomCurve3;
  line: THREE.Line;
  packets: THREE.Mesh[];
  delay: number;
};

type OrbPick = {
  mesh: THREE.Mesh;
  node: GraphNode;
};

function MyceliumCanvas({ graph }: { graph: Graph }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelMountRef = useRef<HTMLDivElement>(null);
  const playingRef = useRef(true);
  const growthRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [fps, setFps] = useState(60);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      playingRef.current = !p;
      return !p;
    });
  }, []);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const container = mountRef.current;
    const labelContainer = labelMountRef.current;
    if (!container || !labelContainer) return;

    const nodes = graph.nodes as GraphNode[];
    const positions = computeLayout(graph);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SOIL);
    scene.fog = new THREE.FogExp2(0x0a0806, 0.028);

    const camera = new THREE.PerspectiveCamera(
      48,
      container.clientWidth / container.clientHeight,
      0.1,
      200,
    );
    camera.position.set(8, 11, 18);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    container.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.inset = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    labelContainer.appendChild(labelRenderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.85,
      0.55,
      0.12,
    );
    composer.addPass(bloom);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 6;
    controls.maxDistance = 45;
    controls.target.set(2, 1, 0);

    const groundGeo = new THREE.PlaneGeometry(80, 80, 64, 64);
    const posAttr = groundGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const h =
        Math.sin(x * 0.15) * 0.35 +
        Math.cos(z * 0.12) * 0.3 +
        (Math.random() - 0.5) * 0.15;
      posAttr.setY(i, h);
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({
        color: 0x1a1410,
        roughness: 0.95,
        metalness: 0.05,
        flatShading: false,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.35;
    scene.add(ground);

    scene.add(new THREE.AmbientLight(0x1a2a28, 0.35));
    const key = new THREE.PointLight(TEAL, 2.2, 40);
    key.position.set(4, 8, 6);
    scene.add(key);
    const fill = new THREE.PointLight(0x0a3040, 1.2, 50);
    fill.position.set(-8, 5, -4);
    scene.add(fill);

    const hyphaeGroup = new THREE.Group();
    scene.add(hyphaeGroup);
    const hyphae: Hypha[] = [];
    const hyphaMat = new THREE.LineBasicMaterial({
      color: TEAL,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });

    const edgeKinds = new Set(["comment-on", "citation"]);
    for (const edge of graph.edges) {
      if (!edgeKinds.has(edge.kind)) continue;
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      if (!a || !b) continue;
      const curve = hyphaCurve(a, b);
      const pts = curve.getPoints(HYPHAE_SEGMENTS);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, hyphaMat.clone());
      hyphaeGroup.add(line);

      const packets: THREE.Mesh[] = [];
      const packetGeo = new THREE.SphereGeometry(0.08, 8, 8);
      const packetMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
      });
      const count = a.distanceTo(b) > 6 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const packet = new THREE.Mesh(packetGeo, packetMat.clone());
        packet.userData.phase = i / count;
        hyphaeGroup.add(packet);
        packets.push(packet);
      }

      const na = nodeById.get(edge.source);
      const delay = na?.created ? new Date(na.created).getTime() % 4000 : Math.random() * 2000;
      hyphae.push({ curve, line, packets, delay });
    }

    const orbsGroup = new THREE.Group();
    scene.add(orbsGroup);
    const picks: OrbPick[] = [];
    const fogGroup = new THREE.Group();
    scene.add(fogGroup);

    const orbGeo = new THREE.SphereGeometry(0.22, 20, 20);
    const orbMat = new THREE.MeshStandardMaterial({
      color: TEAL,
      emissive: TEAL,
      emissiveIntensity: 2.5,
      roughness: 0.25,
      metalness: 0.1,
    });

    for (const n of nodes) {
      const p = positions.get(n.id);
      if (!p) continue;

      if (n.visibility === "private") {
        const fog = new THREE.Mesh(
          new THREE.SphereGeometry(1.4 + Math.random() * 1.2, 16, 16),
          new THREE.MeshBasicMaterial({
            color: TEAL_DIM,
            transparent: true,
            opacity: 0.22,
            depthWrite: false,
          }),
        );
        fog.position.copy(p);
        fog.position.y += 0.8;
        fogGroup.add(fog);
        const wisp = new THREE.Mesh(
          new THREE.SphereGeometry(2.2, 12, 12),
          new THREE.MeshBasicMaterial({
            color: 0x0a2820,
            transparent: true,
            opacity: 0.12,
            depthWrite: false,
          }),
        );
        wisp.position.copy(fog.position);
        fogGroup.add(wisp);
        continue;
      }

      const isOrb =
        n.type === "issue" || n.type === "pull_request";
      if (!isOrb) continue;

      const mesh = new THREE.Mesh(orbGeo, orbMat.clone());
      mesh.position.copy(p);
      mesh.userData = { nodeId: n.id, url: n.url, visibility: n.visibility };
      orbsGroup.add(mesh);
      picks.push({ mesh, node: n });

      const labelEl = document.createElement("div");
      labelEl.className = "mycelium-label";
      const num = n.number != null ? `#${n.number}` : "";
      const title = n.title
        ? n.title.length > 42
          ? `${n.title.slice(0, 40)}…`
          : n.title
        : "";
      const tags = publicTags(n)
        .map(
          (t) =>
            `<span class="mycelium-tag">${t.replace(/</g, "")}</span>`,
        )
        .join("");
      labelEl.innerHTML = `
        <div class="mycelium-label-inner">
          <span class="mycelium-num">${num}</span>
          <span class="mycelium-title">${title.replace(/</g, "")}</span>
          <div class="mycelium-tags">${tags}</div>
        </div>`;
      const label = new CSS2DObject(labelEl);
      label.position.set(0, 0.55, 0);
      mesh.add(label);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(
        picks.map((p) => p.mesh),
        false,
      );
      if (hits.length === 0) return;
      const url = hits[0].object.userData.url as string | undefined;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    };
    renderer.domElement.addEventListener("click", onClick);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloom.resolution.set(w, h);
      labelRenderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    let lastFps = performance.now();
    let fpsFrames = 0;
    let raf = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      const t = clock.elapsedTime;

      if (playingRef.current) {
        growthRef.current = Math.min(growthRef.current + dt * 0.08, 1);
      }

      const growth = growthRef.current;
      const pulse = 0.85 + Math.sin(t * 1.6) * 0.15;

      for (const h of hyphae) {
        const local = Math.min(1, Math.max(0, (growth * 1.15 - h.delay / 5000) * 1.1));
        const steps = Math.max(2, Math.floor(HYPHAE_SEGMENTS * local));
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= steps; i++) {
          pts.push(h.curve.getPoint(i / HYPHAE_SEGMENTS));
        }
        h.line.geometry.dispose();
        h.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
        const wobble = 0.03 * Math.sin(t * 2 + h.delay);
        h.line.position.y = wobble;

        for (const packet of h.packets) {
          const phase = (packet.userData.phase as number) ?? 0;
          const u = (t * 0.22 + phase) % 1;
          const pt = h.curve.getPoint(u * local);
          packet.position.copy(pt);
          packet.position.y += wobble;
          packet.visible = local > 0.15;
        }
      }

      for (const { mesh, node } of picks) {
        const base = positions.get(node.id);
        if (base) {
          mesh.position.y =
            base.y + Math.sin(t * 1.2 + base.x) * 0.06;
        }
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 2.2 * pulse;
      }

      for (const child of fogGroup.children) {
        if (child instanceof THREE.Mesh) {
          child.scale.setScalar(1 + Math.sin(t * 0.8 + child.id) * 0.06);
        }
      }

      controls.update();
      composer.render();

      const labelPulse = document.querySelectorAll(".mycelium-label-inner");
      labelPulse.forEach((el) => {
        (el as HTMLElement).style.opacity = String(0.88 + Math.sin(t) * 0.08);
      });

      labelRenderer.render(scene, camera);

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
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      labelContainer.removeChild(labelRenderer.domElement);
      groundGeo.dispose();
      orbGeo.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
        if (obj instanceof THREE.Line) {
          obj.geometry.dispose();
          if (obj.material) (obj.material as THREE.Material).dispose();
        }
      });
    };
  }, [graph]);

  return (
    <>
      <div ref={mountRef} className="absolute inset-0" />
      <div ref={labelMountRef} className="absolute inset-0 z-10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="pointer-events-auto flex gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="rounded-full bg-black/50 px-4 py-2 text-xs uppercase tracking-wider text-teal-300 ring-1 ring-teal-500/40 backdrop-blur hover:bg-teal-950/60"
          >
            {playing ? "Pause growth" : "Play growth"}
          </button>
        </div>
        <p className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">
          WebGL · {fps} FPS
        </p>
      </div>
      <style jsx global>{`
        .mycelium-label {
          pointer-events: none;
          transform: translate(-50%, -100%);
        }
        .mycelium-label-inner {
          font-family: ui-sans-serif, system-ui, sans-serif;
          color: #e8fffb;
          text-shadow: 0 0 12px rgba(46, 230, 200, 0.55);
          max-width: 220px;
        }
        .mycelium-num {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: #5eead4;
          letter-spacing: 0.05em;
        }
        .mycelium-title {
          display: block;
          font-size: 10px;
          line-height: 1.35;
          color: #cbd5e1;
          margin-top: 2px;
        }
        .mycelium-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 4px;
        }
        .mycelium-tag {
          font-size: 8px;
          text-transform: lowercase;
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(13, 74, 66, 0.85);
          color: #99f6e4;
          border: 1px solid rgba(46, 230, 200, 0.35);
        }
      `}</style>
    </>
  );
}

export default function MyceliumScene() {
  const graph = useWorldGraph();
  return (
    <WorldChrome title="Mycelium">
      <div className="absolute inset-0 bg-[#0c0a08]">
        {graph ? (
          <MyceliumCanvas graph={graph} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Loading public-safe graph…
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-16 z-20 px-4">
        <nav className="pointer-events-auto flex gap-4 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          <span className="border-b border-teal-400 pb-1 text-teal-300">Overview</span>
          <span className="opacity-50">Issues</span>
          <span className="opacity-50">Repos</span>
          <span className="opacity-50">Contributors</span>
          <span className="opacity-50">Activity</span>
        </nav>
      </div>
    </WorldChrome>
  );
}
