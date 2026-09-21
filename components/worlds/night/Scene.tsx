"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { FilmPass } from "three/addons/postprocessing/FilmPass.js";
import type { Graph } from "@/components/worlds/useWorldGraph";
import { isVisualVerifyMode } from "@/components/worlds/visualVerify";
import {
  TYPE_COLORS,
  LIGHT_PRIVATE,
  LIGHT_PUBLIC,
  PRIVATE_GLOW,
  hash01,
  isoToLon,
  isoToYear,
  latForSeed,
  latLonToVec3,
  monthToLon,
} from "./geo";

export type PublicHover = {
  x: number;
  y: number;
  title: string;
  url: string;
  repo: string | null;
};

type GraphNode = Graph["nodes"][number] & {
  id: string;
  type: string;
  created: string;
  visibility: string;
  url?: string;
  title?: string;
  repo?: string | null;
};

type SceneProps = {
  graph: Graph;
  year: number;
  onHover: (h: PublicHover | null) => void;
};

const R = 1;
const SURFACE = R * 1.002;

export default function NightScene({ graph, year, onHover }: SceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const verifyMode = isVisualVerifyMode();
    const w = mount.clientWidth;
    const h = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.08);

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.01, 100);
    camera.position.set(0.15, 0.65, 2.35);
    camera.lookAt(0.05, -0.08, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const earthGroup = new THREE.Group();
    earthGroup.rotation.y = -0.35;
    earthGroup.rotation.x = 0.12;
    scene.add(earthGroup);

    const earthGeo = new THREE.SphereGeometry(R, 64, 48);
    const landCanvas = document.createElement("canvas");
    landCanvas.width = 512;
    landCanvas.height = 256;
    const ctx = landCanvas.getContext("2d")!;
    ctx.fillStyle = "#050508";
    ctx.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 8000; i++) {
      const x = hash01(`lx${i}`) * 512;
      const y = hash01(`ly${i}`) * 256;
      const a = hash01(`la${i}`) * 0.08;
      ctx.fillStyle = `rgba(30,35,45,${a})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    const landTex = new THREE.CanvasTexture(landCanvas);
    landTex.colorSpace = THREE.SRGBColorSpace;
    const earthMat = new THREE.MeshStandardMaterial({
      map: landTex,
      color: new THREE.Color(0x080810),
      roughness: 1,
      metalness: 0,
      emissive: new THREE.Color(0x020204),
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    earthGroup.add(earth);

    const atmoGeo = new THREE.SphereGeometry(R * 1.04, 64, 48);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: 0x1a3a5c,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
    });
    earthGroup.add(new THREE.Mesh(atmoGeo, atmoMat));

    const starsGeo = new THREE.BufferGeometry();
    const starN = 1200;
    const starPos = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const u = hash01(`s${i}`);
      const v = hash01(`s2${i}`);
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const sr = 8 + hash01(`s3${i}`) * 6;
      starPos[i * 3] = sr * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = sr * Math.sin(phi) * Math.sin(theta);
      starPos[i * 3 + 2] = sr * Math.cos(phi);
    }
    starsGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    scene.add(
      new THREE.Points(
        starsGeo,
        new THREE.PointsMaterial({ color: 0x888899, size: 0.015, sizeAttenuation: true }),
      ),
    );

    const ambientGeo = new THREE.BufferGeometry();
    const publicGeo = new THREE.BufferGeometry();
    const ambientMat = new THREE.PointsMaterial({
      size: 0.012,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const publicMat = new THREE.PointsMaterial({
      size: 0.028,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const ambientPts = new THREE.Points(ambientGeo, ambientMat);
    const publicPts = new THREE.Points(publicGeo, publicMat);
    earthGroup.add(ambientPts);
    earthGroup.add(publicPts);

    type PubMeta = { title: string; url: string; repo: string | null };
    let publicMeta: PubMeta[] = [];

    function rebuildPoints() {
      const ambPos: number[] = [];
      const ambCol: number[] = [];
      const pubPos: number[] = [];
      const pubCol: number[] = [];
      publicMeta = [];
      const c = new THREE.Color();

      for (const light of graph.lights) {
        const y = Number(light.month.slice(0, 4));
        if (y > year) continue;
        const lon = monthToLon(light.month);
        for (let i = 0; i < light.n; i++) {
          const seed = `${light.month}:${light.visibility}:${i}`;
          const lat = latForSeed(seed, y);
          const [x, yy, z] = latLonToVec3(lat, lon + (hash01(seed + "j") - 0.5) * 0.04, SURFACE);
          ambPos.push(x, yy, z);
          c.set(light.visibility === "public" ? LIGHT_PUBLIC : LIGHT_PRIVATE);
          c.multiplyScalar(light.visibility === "public" ? 0.35 : 0.18);
          ambCol.push(c.r, c.g, c.b);
        }
      }

      for (const raw of graph.nodes as GraphNode[]) {
        const y = isoToYear(raw.created);
        if (y > year) continue;
        const lon = isoToLon(raw.created);
        const lat = latForSeed(raw.id, y);
        const jitter = (hash01(raw.id + "lon") - 0.5) * 0.025;
        const [x, yy, z] = latLonToVec3(lat, lon + jitter, SURFACE);

        if (raw.visibility === "private") {
          ambPos.push(x, yy, z);
          c.set(PRIVATE_GLOW);
          c.multiplyScalar(0.25);
          ambCol.push(c.r, c.g, c.b);
          continue;
        }

        pubPos.push(x, yy, z);
        c.set(TYPE_COLORS[raw.type] ?? "#fbbf24");
        c.multiplyScalar(1.4);
        pubCol.push(c.r, c.g, c.b);
        publicMeta.push({
          title: String(raw.title ?? "Untitled"),
          url: String(raw.url ?? ""),
          repo: raw.repo ?? null,
        });
      }

      ambientGeo.setAttribute("position", new THREE.Float32BufferAttribute(ambPos, 3));
      ambientGeo.setAttribute("color", new THREE.Float32BufferAttribute(ambCol, 3));
      ambientMat.vertexColors = true;

      publicGeo.setAttribute("position", new THREE.Float32BufferAttribute(pubPos, 3));
      publicGeo.setAttribute("color", new THREE.Float32BufferAttribute(pubCol, 3));
      publicMat.vertexColors = true;
    }

    rebuildPoints();

    scene.add(new THREE.AmbientLight(0x111122, 0.15));
    const rim = new THREE.DirectionalLight(0x224466, 0.25);
    rim.position.set(-3, 2, 1);
    scene.add(rim);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.35, 0.15);
    bloom.threshold = 0.08;
    bloom.strength = 1.35;
    bloom.radius = 0.55;
    composer.addPass(bloom);
    composer.addPass(new FilmPass(0.35, false));

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points!.threshold = 0.035;
    const pointer = new THREE.Vector2();
    let hovered: number | null = null;

    const onMove = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(publicPts);
      if (hits.length > 0 && hits[0].index != null) {
        const idx = hits[0].index;
        if (idx !== hovered) hovered = idx;
        const meta = publicMeta[idx];
        if (meta?.url) {
          onHoverRef.current({
            x: ev.clientX,
            y: ev.clientY,
            title: meta.title,
            url: meta.url,
            repo: meta.repo,
          });
        }
        renderer.domElement.style.cursor = "pointer";
      } else {
        hovered = null;
        onHoverRef.current(null);
        renderer.domElement.style.cursor = "default";
      }
    };

    const onClick = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(publicPts);
      if (hits.length > 0 && hits[0].index != null) {
        const meta = publicMeta[hits[0].index];
        if (meta?.url) window.open(meta.url, "_blank", "noopener,noreferrer");
      }
    };

    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("click", onClick);

    let frame = 0;
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      frame += verifyMode ? 0 : 0.002;
      earthGroup.rotation.y = -0.35 + (verifyMode ? 0 : Math.sin(frame * 0.4) * 0.008);
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
      bloom.resolution.set(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("click", onClick);
      composer.dispose();
      renderer.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      landTex.dispose();
      ambientGeo.dispose();
      publicGeo.dispose();
      starsGeo.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [graph, year]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
