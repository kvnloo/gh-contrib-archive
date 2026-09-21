"use client";

import { useEffect, useRef } from "react";
import type { Graph } from "@/components/worlds/useWorldGraph";
import { isVisualVerifyMode, sceneRng } from "@/components/worlds/visualVerify";
import * as THREE from "three";

const LINE_COLORS = [
  0x00e5ff,
  0x4488ff,
  0x44ff88,
  0xffdd44,
  0xaa66ff,
  0xff44aa,
  0x66ffcc,
  0xff8844,
  0xe040fb,
  0x18ffff,
  0x76ff03,
  0xff6e40,
];

const LOOP_R = 3.2;
const MAX_ORGS = 14;
const MAX_REPOS_PER_ORG = 4;

function formatRidership(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

function hexColor(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

type Train = { mesh: THREE.Mesh; curve: THREE.Curve<THREE.Vector3>; speed: number; t: number };

type StationHit = { mesh: THREE.Mesh; repo: string };

export default function MetroScene({ graph }: { graph: Graph }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    const verifyMode = isVisualVerifyMode();
    const rng = sceneRng(0x4d455452);
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050508);
    scene.fog = new THREE.FogExp2(0x0a0a14, 0.028);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 120);
    camera.position.set(0, 11.5, 13.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x223344, 0.35);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xaaccff, 0.25);
    key.position.set(5, 12, 8);
    scene.add(key);

    // Wet reflective platform
    const floorCanvas = document.createElement("canvas");
    floorCanvas.width = 512;
    floorCanvas.height = 512;
    const ctx = floorCanvas.getContext("2d")!;
    ctx.fillStyle = "#0c0c10";
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = "#1a1a22";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 32; i++) {
      const p = (i / 32) * 512;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(512, p);
      ctx.stroke();
    }
    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(8, 8);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(22, 64),
      new THREE.MeshPhysicalMaterial({
        color: 0x0a0a0f,
        metalness: 0.92,
        roughness: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        map: floorTex,
        envMapIntensity: 0.6,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    scene.add(floor);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(21.5, 0.08, 8, 128),
      new THREE.MeshBasicMaterial({ color: 0x222233 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.01;
    scene.add(rim);

    // Central Yamanote loop — triple neon ring
    const loopGroup = new THREE.Group();
    for (let ring = 0; ring < 3; ring++) {
      const r = LOOP_R - ring * 0.14;
      const loopCurve = new THREE.EllipseCurve(0, 0, r, r, 0, Math.PI * 2, false, 0);
      const pts = loopCurve.getPoints(128).map((p) => new THREE.Vector3(p.x, 0.06 + ring * 0.02, p.y));
      const loopGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const loopMat = new THREE.LineBasicMaterial({
        color: 0xff2d95,
        transparent: true,
        opacity: 0.55 + ring * 0.15,
      });
      const loopLine = new THREE.Line(loopGeo, loopMat);
      loopGroup.add(loopLine);

      const tubeCurve = new THREE.CatmullRomCurve3(pts, true);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(tubeCurve, 128, 0.03 + ring * 0.01, 6, true),
        new THREE.MeshBasicMaterial({
          color: 0xff44aa,
          transparent: true,
          opacity: 0.35,
        }),
      );
      loopGroup.add(tube);
    }
    scene.add(loopGroup);

    const loopGlow = new THREE.PointLight(0xff3399, 2.2, 18);
    loopGlow.position.set(0, 1.5, 0);
    scene.add(loopGlow);

    const trains: Train[] = [];
    const stationHits: StationHit[] = [];
    const labelEls: { el: HTMLDivElement; world: THREE.Vector3 }[] = [];

    const maxRepoN = Math.max(...graph.repos.map((r) => r.n), 1);
    const orgs = graph.orgs.slice(0, MAX_ORGS);

    orgs.forEach((orgEntry, oi) => {
      const color = LINE_COLORS[oi % LINE_COLORS.length];
      const baseAngle = (oi / orgs.length) * Math.PI * 2 - Math.PI / 2;
      const repos = graph.repos
        .filter((r) => r.repo.startsWith(`${orgEntry.org}/`))
        .slice(0, MAX_REPOS_PER_ORG);

      if (repos.length === 0) return;

      const loopAttach = new THREE.Vector3(
        Math.cos(baseAngle) * LOOP_R,
        0.08,
        Math.sin(baseAngle) * LOOP_R,
      );

      repos.forEach((repoEntry, ri) => {
        const spread = repos.length > 1 ? (ri - (repos.length - 1) / 2) * 0.22 : 0;
        const angle = baseAngle + spread;
        const dist = 7 + ri * 2.8 + (repoEntry.n / maxRepoN) * 2;
        const stationPos = new THREE.Vector3(Math.cos(angle) * dist, 0.1, Math.sin(angle) * dist);

        const mid = loopAttach.clone().lerp(stationPos, 0.45);
        mid.y = 0.12;

        const curve = new THREE.CatmullRomCurve3(
          [loopAttach.clone(), mid, stationPos.clone()],
          false,
          "catmullrom",
          0.35,
        );

        const tubeMesh = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 64, 0.045, 6, false),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.75,
          }),
        );
        scene.add(tubeMesh);

        const glowTube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 64, 0.09, 6, false),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.12,
          }),
        );
        scene.add(glowTube);

        const radius = 0.18 + (repoEntry.n / maxRepoN) * 0.45;
        const stationMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius * 1.1, 0.12, 24),
          new THREE.MeshStandardMaterial({
            color: 0x111118,
            emissive: color,
            emissiveIntensity: 0.85,
            metalness: 0.6,
            roughness: 0.25,
          }),
        );
        stationMesh.position.copy(stationPos);
        scene.add(stationMesh);

        const ringMesh = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 1.15, 0.025, 8, 32),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
        );
        ringMesh.rotation.x = Math.PI / 2;
        ringMesh.position.copy(stationPos);
        ringMesh.position.y = 0.14;
        scene.add(ringMesh);

        stationHits.push({ mesh: stationMesh, repo: repoEntry.repo });

        const [orgName, repoName] = repoEntry.repo.split("/");
        const label = document.createElement("div");
        label.className = "metro-station-label pointer-events-none absolute whitespace-nowrap";
        label.style.cssText = `
          transform: translate(-50%, -100%);
          padding: 4px 8px;
          font-size: 10px;
          line-height: 1.25;
          background: rgba(8,8,14,0.82);
          border: 1px solid ${hexColor(color)}88;
          box-shadow: 0 0 12px ${hexColor(color)}44;
          border-radius: 4px;
          color: #f0f0f5;
          font-family: system-ui, sans-serif;
          text-align: center;
        `;
        label.innerHTML = `<div style="color:#aaa;font-size:9px">${orgName}</div><div style="font-weight:600">${repoName}</div>`;
        overlay.appendChild(label);
        labelEls.push({ el: label, world: stationPos.clone().add(new THREE.Vector3(0, 0.9, 0)) });

        const trainMesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.06, 0.06),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }),
        );
        scene.add(trainMesh);
        trains.push({
          mesh: trainMesh,
          curve,
          speed: 0.12 + (ri % 3) * 0.04 + oi * 0.008,
          t: rng(),
        });
      });
    });

    // Loop train
    const loopPts = new THREE.EllipseCurve(0, 0, LOOP_R, LOOP_R, 0, Math.PI * 2, false, 0)
      .getPoints(128)
      .map((p) => new THREE.Vector3(p.x, 0.1, p.y));
    const loopTrainCurve = new THREE.CatmullRomCurve3(loopPts, true);
    const loopTrain = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.07, 0.07),
      new THREE.MeshBasicMaterial({ color: 0xff88cc, transparent: true, opacity: 1 }),
    );
    scene.add(loopTrain);
    trains.push({ mesh: loopTrain, curve: loopTrainCurve, speed: 0.06, t: 0 });

    // Private tunnels
    const privateNodes = graph.nodes.filter((n) => String(n.visibility).toLowerCase() === "private").length;
    const privateCommits = graph.commits
      .filter((c) => c.visibility === "private")
      .reduce((a, c) => a + c.count, 0);
    const tunnelCount = Math.min(10, Math.max(5, Math.ceil(Math.sqrt(privateNodes + privateCommits))));

    const weights = Array.from({ length: tunnelCount }, (_, i) => 0.6 + Math.sin(i * 1.7) * 0.4);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const riderships = weights.map((w) => Math.round(((privateNodes + privateCommits) * w) / wSum));

    for (let ti = 0; ti < tunnelCount; ti++) {
      const angle = (ti / tunnelCount) * Math.PI * 2 + 0.4;
      const outer = new THREE.Vector3(Math.cos(angle) * 17.5, 0.2, Math.sin(angle) * 17.5);
      const inner = new THREE.Vector3(Math.cos(angle) * LOOP_R * 0.85, 0.08, Math.sin(angle) * LOOP_R * 0.85);

      const tunnelCurve = new THREE.CatmullRomCurve3([inner, outer], false);
      scene.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(tunnelCurve, 32, 0.035, 6, false),
          new THREE.MeshBasicMaterial({ color: 0x333344, transparent: true, opacity: 0.5 }),
        ),
      );

      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.06, 8, 24, Math.PI),
        new THREE.MeshStandardMaterial({
          color: 0x151520,
          emissive: 0x222233,
          emissiveIntensity: 0.3,
          metalness: 0.8,
          roughness: 0.4,
        }),
      );
      arch.position.copy(outer);
      arch.rotation.y = -angle + Math.PI / 2;
      arch.rotation.x = Math.PI / 2;
      scene.add(arch);

      const label = document.createElement("div");
      label.className = "metro-tunnel-label pointer-events-none absolute whitespace-nowrap";
      label.style.cssText = `
        transform: translate(-50%, -50%);
        padding: 3px 7px;
        font-size: 10px;
        background: rgba(6,6,10,0.9);
        border: 1px solid #444455;
        border-radius: 3px;
        color: #999;
        font-family: system-ui, sans-serif;
      `;
      label.textContent = `👤 ${formatRidership(riderships[ti])}`;
      overlay.appendChild(label);
      labelEls.push({ el: label, world: outer.clone().add(new THREE.Vector3(0, 0.75, 0)) });
    }

    // Distant city haze lights
    const cityGroup = new THREE.Group();
    for (let i = 0; i < 80; i++) {
      const a = rng() * Math.PI * 2;
      const d = 35 + rng() * 25;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.04 + rng() * 0.06, 6, 6),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(0.55 + rng() * 0.15, 0.5, 0.35 + rng() * 0.2),
          transparent: true,
          opacity: 0.35 + rng() * 0.35,
        }),
      );
      dot.position.set(Math.cos(a) * d, 1 + rng() * 4, Math.sin(a) * d - 15);
      cityGroup.add(dot);
    }
    scene.add(cityGroup);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: THREE.Mesh | null = null;

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const meshes = stationHits.map((s) => s.mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits[0]) {
        const hit = stationHits.find((s) => s.mesh === hits[0].object);
        if (hit && hovered !== hit.mesh) {
          hovered = hit.mesh;
          renderer.domElement.style.cursor = "pointer";
        }
      } else {
        hovered = null;
        renderer.domElement.style.cursor = "default";
      }
    };

    const onClick = () => {
      raycaster.setFromCamera(pointer, camera);
      const meshes = stationHits.map((s) => s.mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits[0]) {
        const hit = stationHits.find((s) => s.mesh === hits[0].object);
        if (hit) window.open(`https://github.com/${hit.repo}`, "_blank", "noopener,noreferrer");
      }
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("click", onClick);

    let frameId = 0;
    const clock = new THREE.Clock();

    const updateLabels = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      for (const { el, world } of labelEls) {
        const p = world.clone().project(camera);
        if (p.z > 1) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "block";
        el.style.left = `${(p.x * 0.5 + 0.5) * w}px`;
        el.style.top = `${(-p.y * 0.5 + 0.5) * h}px`;
      }
    };

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const dt = verifyMode ? 0 : clock.getDelta();

      for (const tr of trains) {
        tr.t = (tr.t + tr.speed * dt) % 1;
        const pos = tr.curve.getPointAt(tr.t);
        const tangent = tr.curve.getTangentAt(tr.t).normalize();
        tr.mesh.position.copy(pos);
        tr.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
        const pulse = 0.7 + Math.sin(tr.t * Math.PI * 8) * 0.3;
        (tr.mesh.material as THREE.MeshBasicMaterial).opacity = pulse;
      }

      loopGlow.intensity = 2 + Math.sin((verifyMode ? 0 : clock.elapsedTime) * 1.2) * 0.4;
      updateLabels();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("click", onClick);
      labelEls.forEach(({ el }) => el.remove());
      renderer.dispose();
      container.removeChild(renderer.domElement);
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

  return (
    <>
      <div ref={mountRef} className="absolute inset-0" />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </>
  );
}
