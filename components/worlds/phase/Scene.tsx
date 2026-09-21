"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Graph } from "@/components/worlds/useWorldGraph";
import { useWorldGraph } from "@/components/worlds/useWorldGraph";
import { isVisualVerifyMode } from "@/components/worlds/visualVerify";

type GraphNode = Graph["nodes"][number] & {
  id?: string;
  type?: string;
  created?: string;
  visibility?: string;
  url?: string;
};

type BeadKind = "issue" | "pull_request" | "comment";

function beadKind(type: string | undefined): BeadKind {
  if (type === "issue") return "issue";
  if (type === "pull_request") return "pull_request";
  return "comment";
}

function makeIconTexture(kind: BeadKind, tint: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = tint;
  ctx.fillStyle = tint;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const cx = size / 2;
  const cy = size / 2;

  if (kind === "issue") {
    ctx.font = "bold 72px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("#", cx, cy + 4);
  } else if (kind === "pull_request") {
    ctx.beginPath();
    ctx.arc(cx - 22, cy + 8, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 22, cy - 8, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy + 8);
    ctx.lineTo(cx + 8, cy - 8);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.roundRect(cx - 34, cy - 22, 68, 44, 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 22);
    ctx.lineTo(cx - 22, cy + 38);
    ctx.lineTo(cx + 2, cy + 22);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function silverPalette(t: number): THREE.Color {
  const c = new THREE.Color();
  c.setHSL(0.58, 0.08 + t * 0.12, 0.55 + t * 0.25);
  return c;
}

function agentPalette(t: number): THREE.Color {
  const c = new THREE.Color();
  const hue = 0.92 - t * 0.12;
  c.setHSL(hue, 0.85, 0.52 + t * 0.15);
  return c;
}

function partitionNodes(nodes: GraphNode[]) {
  const cutoff = new Date("2025-01-01T00:00:00Z").getTime();
  const inner: GraphNode[] = [];
  const outer: GraphNode[] = [];
  for (const n of nodes) {
    const ts = n.created ? new Date(n.created).getTime() : 0;
    if (ts < cutoff) inner.push(n);
    else outer.push(n);
  }
  inner.sort((a, b) => (a.created ?? "").localeCompare(b.created ?? ""));
  outer.sort((a, b) => (a.created ?? "").localeCompare(b.created ?? ""));
  return { inner, outer };
}

function placeOnRing(
  group: THREE.Group,
  nodes: GraphNode[],
  radius: number,
  y: number,
  era: "human" | "agent",
  clickable: THREE.Mesh[]
) {
  const n = nodes.length;
  if (n === 0) return;

  const beadGeo = new THREE.SphereGeometry(0.22, 24, 24);
  const iconGeo = new THREE.PlaneGeometry(0.28, 0.28);

  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    const isPublic = node.visibility === "public";
    const t = n > 1 ? i / (n - 1) : 0.5;
    const angle = -Math.PI * 0.75 + t * Math.PI * 1.5;

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    let base: THREE.Color;
    let emissive: THREE.Color;
    if (!isPublic) {
      base = new THREE.Color(0x141418);
      emissive = new THREE.Color(0x020203);
    } else if (era === "human") {
      base = silverPalette(t);
      emissive = base.clone().multiplyScalar(0.85);
    } else {
      base = agentPalette(t);
      emissive = base.clone().multiplyScalar(0.9);
    }

    const mat = new THREE.MeshStandardMaterial({
      color: base,
      emissive,
      emissiveIntensity: isPublic ? 1.4 : 0.05,
      metalness: isPublic ? 0.65 : 0.2,
      roughness: isPublic ? 0.25 : 0.85,
    });

    const bead = new THREE.Mesh(beadGeo, mat);
    bead.position.set(x, y, z);
    bead.userData = { url: isPublic ? node.url : null, public: isPublic };
    group.add(bead);
    if (isPublic && node.url) clickable.push(bead);

    if (isPublic) {
      const kind = beadKind(node.type);
      const iconTex = makeIconTexture(kind, "rgba(255,255,255,0.92)");
      const iconMat = new THREE.MeshBasicMaterial({
        map: iconTex,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const icon = new THREE.Mesh(iconGeo, iconMat);
      icon.position.copy(bead.position);
      icon.position.y += 0.01;
      icon.lookAt(0, y, 0);
      group.add(icon);
    }
  }

  const ringLine = new THREE.BufferGeometry();
  const segments = 256;
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
  }
  ringLine.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x1a1a22, transparent: true, opacity: 0.55 });
  group.add(new THREE.LineLoop(ringLine, lineMat));
}

function PhaseCanvas({ graph }: { graph: Graph }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !graph) return;

    const verifyMode = isVisualVerifyMode();
    const w = mount.clientWidth;
    const h = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030305);
    scene.fog = new THREE.FogExp2(0x030305, 0.018);

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    camera.position.set(0, 5.5, 14);
    camera.lookAt(0, 0.2, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const floorGeo = new THREE.CircleGeometry(28, 128);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x020202,
      metalness: 0.95,
      roughness: 0.12,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.35;
    scene.add(floor);

    const key = new THREE.SpotLight(0xffffff, 120, 40, Math.PI / 5, 0.35, 1);
    key.position.set(6, 12, 8);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0x404060, 0.35));

    const rimL = new THREE.PointLight(0xaaccff, 40, 30);
    rimL.position.set(-10, 4, -6);
    scene.add(rimL);
    const rimR = new THREE.PointLight(0xff66cc, 55, 30);
    rimR.position.set(10, 3, 6);
    scene.add(rimR);

    const { inner, outer } = partitionNodes(graph.nodes as GraphNode[]);
    const innerRing = new THREE.Group();
    const outerRing = new THREE.Group();
    const clickable: THREE.Mesh[] = [];

    placeOnRing(innerRing, inner, 4.2, 0.15, "human", clickable);
    placeOnRing(outerRing, outer, 6.4, -0.05, "agent", clickable);

    innerRing.rotation.x = 0.32;
    outerRing.rotation.x = 0.28;
    scene.add(innerRing);
    scene.add(outerRing);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.45, 0.15);
    composer.addPass(bloom);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onClick = (ev: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickable, false);
      const url = hits[0]?.object.userData?.url as string | null | undefined;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    };
    renderer.domElement.addEventListener("click", onClick);

    let innerPhase = 0;
    let outerPhase = 0;
    const innerSpeed = 0.045;
    const outerSpeed = 0.045 * 1.013;

    let frame = 0;
    const clock = new THREE.Clock();
    let raf = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = verifyMode ? 0 : clock.getDelta();
      innerPhase += dt * innerSpeed;
      outerPhase += dt * outerSpeed;
      innerRing.rotation.y = innerPhase;
      outerRing.rotation.y = outerPhase;
      innerRing.position.y = 0.15 + Math.sin(frame * 0.008) * 0.06;
      outerRing.position.y = -0.05 + Math.sin(frame * 0.008 + 1.2) * 0.06;
      if (!verifyMode) frame++;
      composer.render();
    };
    animate();

    const onResize = () => {
      const nw = mount.clientWidth;
      const nh = mount.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      composer.setSize(nw, nh);
      bloom.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      pmrem.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
    };
  }, [graph]);

  return <div ref={mountRef} className="absolute inset-0" />;
}

export default function PhaseScene() {
  const graph = useWorldGraph();

  return (
    <div className="relative h-full w-full">
      {graph ? (
        <PhaseCanvas graph={graph} />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
          Loading public-safe graph…
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-6 pt-20">
        <div className="flex justify-between text-[10px] uppercase tracking-[0.35em] sm:text-xs">
          <div className="flex gap-4 text-zinc-100">
            <span className="border-b border-white/70 pb-0.5">World 2016</span>
            <span className="text-zinc-300">World 2017</span>
            <span className="text-zinc-300">World 2018</span>
          </div>
          <div className="flex gap-4 text-fuchsia-300">
            <span>World 2025</span>
            <span>World 2026</span>
          </div>
        </div>

        <div className="absolute left-1/2 top-[52%] -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="text-2xl font-light tracking-[0.55em] text-white/95 sm:text-3xl">PHASE</p>
        </div>

        <div className="flex justify-between text-[10px] uppercase tracking-[0.3em] sm:text-xs">
          <span className="text-zinc-200">2016–2018 Human era</span>
          <span className="text-fuchsia-300">2025–2026 Agent era</span>
        </div>
      </div>
    </div>
  );
}
