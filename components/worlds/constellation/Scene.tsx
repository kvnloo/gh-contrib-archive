"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { WorldChrome } from "@/components/worlds/WorldChrome";
import { useWorldGraph } from "@/components/worlds/useWorldGraph";
import { isVisualVerifyMode, sceneRng } from "@/components/worlds/visualVerify";

type RawNode = {
  id: string;
  type: string;
  visibility: string;
  url?: string;
  repo?: string;
  org?: string;
  number?: number;
  title?: string;
  created?: string;
  flags?: string[];
};

type StarKind = "catalog" | "dust" | "private";

type Star = {
  id: string;
  kind: StarKind;
  x: number;
  y: number;
  z: number;
  size: number;
  color: THREE.Color;
  url?: string;
  repo?: string;
  number?: number;
  title?: string;
  created?: string;
  nodeType?: string;
  agentTemplate: boolean;
  degree: number;
};

const STAR_TYPES = new Set(["issue", "pull_request"]);
const HERMES_REPO = "kvnloo/hermes-agent";
const BUSIEST_REPO = "kvnloo/kerdoios";

function isStarNode(n: RawNode) {
  return n.visibility === "public" && STAR_TYPES.has(n.type);
}

function shortRepo(repo: string) {
  const slash = repo.indexOf("/");
  return slash >= 0 ? repo.slice(slash + 1) : repo;
}

function starLabel(star: Star) {
  if (star.kind !== "catalog" || !star.repo) return "";
  const name = shortRepo(star.repo);
  if (star.number != null) return `${name} #${star.number}`;
  return name;
}

function layoutStars(
  nodes: RawNode[],
  citations: { source: string; target: string }[],
): { stars: Star[]; lines: { a: string; b: string; name: string }[] } {
  const rng = sceneRng(0x434f4e53);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const catalogIds = new Set<string>();
  const starNodes = nodes.filter(isStarNode);
  starNodes.forEach((n) => catalogIds.add(n.id));

  const lines = citations.filter((e) => catalogIds.has(e.source) && catalogIds.has(e.target));

  const degree = new Map<string, number>();
  for (const e of lines) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const connected = new Set(degree.keys());
  const hermesIds = new Set(starNodes.filter((n) => n.repo === HERMES_REPO).map((n) => n.id));

  const pos = new Map<string, { x: number; y: number; z: number }>();

  const clusterIds = new Set<string>([...connected, ...hermesIds]);
  const clusterList = [...clusterIds];
  const nCluster = clusterList.length;
  const golden = Math.PI * (3 - Math.sqrt(5));
  clusterList.forEach((id, i) => {
    const n = byId.get(id);
    const isHermes = n?.repo === HERMES_REPO;
    const r = isHermes ? 8 + (i % 5) * 2 : 35 + Math.sqrt(i / nCluster) * 55;
    const t = i * golden;
    const bias = isHermes ? 0 : 1;
    pos.set(id, {
      x: Math.cos(t) * r * bias + (isHermes ? (i % 3) * 4 - 4 : 0),
      y: Math.sin(t) * r * 0.65 * bias + (isHermes ? (i % 4) * 3 - 5 : 0),
      z: (rng() - 0.5) * (isHermes ? 6 : 18),
    });
  });

  for (let iter = 0; iter < 80; iter++) {
    const forces = new Map<string, { x: number; y: number; z: number }>();
    for (const id of clusterList) forces.set(id, { x: 0, y: 0, z: 0 });

    for (let i = 0; i < clusterList.length; i++) {
      for (let j = i + 1; j < clusterList.length; j++) {
        const a = clusterList[i];
        const b = clusterList[j];
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dz = pa.z - pb.z;
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const f = 120 / d2;
        dx *= f;
        dy *= f;
        dz *= f;
        forces.get(a)!.x += dx;
        forces.get(a)!.y += dy;
        forces.get(a)!.z += dz;
        forces.get(b)!.x -= dx;
        forces.get(b)!.y -= dy;
        forces.get(b)!.z -= dz;
      }
    }

    for (const e of lines) {
      if (!pos.has(e.source) || !pos.has(e.target)) continue;
      const pa = pos.get(e.source)!;
      const pb = pos.get(e.target)!;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dz = pb.z - pa.z;
      const k = 0.08;
      forces.get(e.source)!.x += dx * k;
      forces.get(e.source)!.y += dy * k;
      forces.get(e.source)!.z += dz * k;
      forces.get(e.target)!.x -= dx * k;
      forces.get(e.target)!.y -= dy * k;
      forces.get(e.target)!.z -= dz * k;
    }

    for (const id of hermesIds) {
      forces.get(id)!.x -= pos.get(id)!.x * 0.04;
      forces.get(id)!.y -= pos.get(id)!.y * 0.04;
    }

    const busiestIds = starNodes.filter((n) => n.repo === BUSIEST_REPO).map((n) => n.id);
    for (const id of busiestIds) {
      if (!forces.has(id)) continue;
      forces.get(id)!.x -= (pos.get(id)!.x - 28) * 0.02;
      forces.get(id)!.y -= (pos.get(id)!.y + 12) * 0.02;
    }

    for (const id of clusterList) {
      const p = pos.get(id)!;
      const f = forces.get(id)!;
      p.x += f.x * 0.15;
      p.y += f.y * 0.15;
      p.z += f.z * 0.15;
    }
  }

  const stars: Star[] = [];

  for (const n of starNodes) {
    const isConnected = connected.has(n.id) || hermesIds.has(n.id);
    const agentTemplate = (n.flags ?? []).includes("agent_template");
    const deg = degree.get(n.id) ?? 0;

    if (isConnected || n.repo === HERMES_REPO || n.repo === BUSIEST_REPO) {
      const p = pos.get(n.id) ?? {
        x: (rng() - 0.5) * 40,
        y: (rng() - 0.5) * 30,
        z: (rng() - 0.5) * 20,
      };
      const base = agentTemplate ? new THREE.Color(0xff4fd8) : new THREE.Color(0xe8f4ff);
      stars.push({
        id: n.id,
        kind: "catalog",
        x: p.x,
        y: p.y,
        z: p.z,
        size: 1.2 + Math.min(deg, 6) * 0.35 + (n.repo === HERMES_REPO ? 0.5 : 0),
        color: base,
        url: n.url,
        repo: n.repo,
        number: n.number,
        title: n.title,
        created: n.created,
        nodeType: n.type,
        agentTemplate,
        degree: deg,
      });
    } else {
      stars.push({
        id: n.id,
        kind: "dust",
        x: (rng() - 0.5) * 220,
        y: (rng() - 0.5) * 160,
        z: (rng() - 0.5) * 80 - 40,
        size: 0.35 + rng() * 0.25,
        color: new THREE.Color(0x6a7a8a),
        url: n.url,
        repo: n.repo,
        number: n.number,
        title: n.title,
        created: n.created,
        agentTemplate: false,
        degree: 0,
      });
    }
  }

  for (const n of nodes) {
    if (n.visibility !== "private") continue;
    if (!STAR_TYPES.has(n.type) && n.type !== "comment") continue;
    stars.push({
      id: n.id,
      kind: "private",
      x: (rng() - 0.5) * 260,
      y: (rng() - 0.5) * 180,
      z: (rng() - 0.5) * 100 - 50,
      size: 0.2 + rng() * 0.15,
      color: new THREE.Color(0x2a3040),
      agentTemplate: false,
      degree: 0,
    });
  }

  const bgCount = 400;
  for (let i = 0; i < bgCount; i++) {
    stars.push({
      id: `bg-${i}`,
      kind: "dust",
      x: (rng() - 0.5) * 320,
      y: (rng() - 0.5) * 240,
      z: (rng() - 0.5) * 120 - 60,
      size: 0.15 + rng() * 0.2,
      color: new THREE.Color(0x888899),
      agentTemplate: false,
      degree: 0,
    });
  }

  const lineMeta = lines.map((e) => {
    const sa = stars.find((s) => s.id === e.source);
    const sb = stars.find((s) => s.id === e.target);
    const na = sa ? starLabel(sa) : e.source.slice(0, 6);
    const nb = sb ? starLabel(sb) : e.target.slice(0, 6);
    return { a: e.source, b: e.target, name: `${na} ↔ ${nb}` };
  });

  return { stars, lines: lineMeta };
}

function relativeOpened(created?: string) {
  if (!created) return "";
  const t = Date.parse(created);
  if (Number.isNaN(t)) return "";
  const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (days === 0) return "opened today";
  if (days === 1) return "opened 1 day ago";
  return `opened ${days} days ago`;
}

export default function ConstellationScene() {
  const graph = useWorldGraph();
  const mountRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [repoFilter, setRepoFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Star | null>(null);
  const [hovered, setHovered] = useState<Star | null>(null);
  const labelEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const starsRef = useRef<Star[]>([]);
  const linesRef = useRef<{ a: string; b: string }[]>([]);
  const starById = useRef<Map<string, Star>>(new Map());

  const layout = useMemo(() => {
    if (!graph) return null;
    const nodes = graph.nodes as RawNode[];
    const citations = graph.edges.filter((e) => e.kind === "citation");
    return layoutStars(nodes, citations);
  }, [graph]);

  const templateNodes = useMemo(() => {
    if (!graph) return [] as RawNode[];
    return (graph.nodes as RawNode[]).filter((n) => (n.flags ?? []).includes("agent_template"));
  }, [graph]);

  const subtitle = repoFilter ? shortRepo(repoFilter) : graph?.login ?? "…";

  const filterRef = useRef({ query, repoFilter });
  const hoverRef = useRef<Star | null>(null);
  const selectedRef = useRef<Star | null>(null);
  useEffect(() => {
    filterRef.current = { query, repoFilter };
    hoverRef.current = hovered;
    selectedRef.current = selected;
  });

  const matchStar = (s: Star, q: string, repo: string | null) => {
    if (s.kind !== "catalog") return false;
    if (repo && s.repo !== repo) return false;
    if (!q.trim()) return true;
    const ql = q.toLowerCase();
    return (
      (s.title?.toLowerCase().includes(ql) ?? false) ||
      (s.repo?.toLowerCase().includes(ql) ?? false) ||
      String(s.number ?? "").includes(ql) ||
      starLabel(s).toLowerCase().includes(ql)
    );
  };

  useEffect(() => {
    if (!layout || !mountRef.current) return;
    const mount = mountRef.current;
    starsRef.current = layout.stars;
    linesRef.current = layout.lines;
    starById.current = new Map(layout.stars.map((s) => [s.id, s]));

    const verifyMode = isVisualVerifyMode();
    const w = mount.clientWidth;
    const h = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020208, 0.008);

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 800);
    camera.position.set(0, 0, 95);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const nebulaGeo = new THREE.PlaneGeometry(200, 140);
    const nebulaMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          vec2 p = vUv - 0.5;
          float d = length(p * vec2(1.0, 0.85));
          float a = smoothstep(0.55, 0.0, d) * 0.35;
          float pulse = 0.92 + 0.08 * sin(uTime * 0.3);
          vec3 col = mix(vec3(0.12, 0.02, 0.22), vec3(0.55, 0.08, 0.45), 1.0 - d * 1.4);
          gl_FragColor = vec4(col * pulse, a);
        }
      `,
    });
    const nebula = new THREE.Mesh(nebulaGeo, nebulaMat);
    nebula.position.set(-25, -8, -45);
    scene.add(nebula);

    const templatePositions: number[] = [];
    const templateColors: number[] = [];
    templateNodes.forEach((_, i) => {
      const t = i * 0.7;
      templatePositions.push(-18 + Math.cos(t) * 22, -5 + Math.sin(t) * 14, -12 + (i % 5) * 2);
      templateColors.push(1, 0.35, 0.85);
    });
    if (templatePositions.length) {
      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute("position", new THREE.Float32BufferAttribute(templatePositions, 3));
      tGeo.setAttribute("color", new THREE.Float32BufferAttribute(templateColors, 3));
      const tPts = new THREE.Points(
        tGeo,
        new THREE.PointsMaterial({ size: 2.4, vertexColors: true, transparent: true, opacity: 0.85 }),
      );
      scene.add(tPts);
    }

    const linePositions: number[] = [];
    const lineColors: number[] = [];
    for (const ln of layout.lines) {
      const a = starById.current.get(ln.a);
      const b = starById.current.get(ln.b);
      if (!a || !b) continue;
      linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const c = new THREE.Color(0xaaccff);
      lineColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    lineGeo.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
    const lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 }),
    );
    scene.add(lines);

    const catalogStars = layout.stars.filter((s) => s.kind === "catalog");
    const dustStars = layout.stars.filter((s) => s.kind !== "catalog");

    const makeStarPoints = (list: Star[], sizeMul: number) => {
      const positions: number[] = [];
      const colors: number[] = [];
      const sizes: number[] = [];
      const ids: string[] = [];
      for (const s of list) {
        positions.push(s.x, s.y, s.z);
        colors.push(s.color.r, s.color.g, s.color.b);
        sizes.push(s.size * sizeMul);
        ids.push(s.id);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
      return { geo, ids, list };
    };

    const dust = makeStarPoints(dustStars, 1);
    const dustMat = new THREE.PointsMaterial({
      size: 1.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const dustPts = new THREE.Points(dust.geo, dustMat);
    scene.add(dustPts);

    const catalog = makeStarPoints(catalogStars, 2.2);
    const catalogMat = new THREE.PointsMaterial({
      size: 2.8,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      sizeAttenuation: true,
      map: undefined,
    });
    const catalogPts = new THREE.Points(catalog.geo, catalogMat);
    scene.add(catalogPts);

    const catalogIndexToId = catalog.ids;

    const parallax = { x: 0, y: 0 };
    const onMove = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      parallax.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      parallax.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 1.8 };
    const mouse = new THREE.Vector2();

    const onClick = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(catalogPts);
      if (!hits.length) {
        setSelected(null);
        return;
      }
      const idx = hits[0].index ?? 0;
      const id = catalogIndexToId[idx];
      const star = starById.current.get(id);
      if (star?.kind === "catalog" && star.url) {
        setSelected(star);
        window.open(star.url, "_blank", "noopener,noreferrer");
      }
    };
    mount.addEventListener("click", onClick);

    const onPointer = (e: MouseEvent) => {
      onMove(e);
      const rect = mount.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(catalogPts);
      if (!hits.length) {
        setHovered(null);
        return;
      }
      const idx = hits[0].index ?? 0;
      setHovered(starById.current.get(catalogIndexToId[idx]) ?? null);
    };
    mount.addEventListener("mousemove", onPointer);

    let frame = 0;
    let raf = 0;
    const animate = () => {
      if (!verifyMode) frame++;
      nebulaMat.uniforms.uTime.value = verifyMode ? 0 : frame * 0.016;
      camera.position.x = parallax.x * 6;
      camera.position.y = -parallax.y * 4;
      camera.lookAt(parallax.x * 2, -parallax.y * 1.5, 0);
      nebula.position.x = -25 + parallax.x * 8;
      nebula.position.y = -8 - parallax.y * 5;

      const v = new THREE.Vector3();
      for (const [id, el] of labelEls.current) {
        const s = starById.current.get(id);
        if (!s || s.kind !== "catalog") {
          el.style.opacity = "0";
          continue;
        }
        const { query: fq, repoFilter: fr } = filterRef.current;
        const visible = matchStar(s, fq, fr);
        const lit = visible && (!fq && !fr ? s.degree > 0 || s.repo === HERMES_REPO : true);
        const sel = selectedRef.current;
        const hov = hoverRef.current;
        if (!lit && !sel?.id && !hov?.id) {
          el.style.opacity = visible ? "0.35" : "0.08";
        } else if (sel?.id === id || hov?.id === id) {
          el.style.opacity = "1";
        } else {
          el.style.opacity = visible ? (fq || fr ? "1" : "0.7") : "0.06";
        }
        v.set(s.x, s.y, s.z);
        v.project(camera);
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h;
        el.style.transform = `translate(-50%, -120%) translate(${x}px, ${y}px)`;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    const onResize = () => {
      const nw = mount.clientWidth;
      const nh = mount.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      mount.removeEventListener("mousemove", onPointer);
      mount.removeEventListener("click", onClick);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [layout, templateNodes]);

  const catalogForLabels = layout?.stars.filter((s) => s.kind === "catalog") ?? [];

  if (!graph || !layout) {
    return (
      <WorldChrome title="Constellation">
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading public-safe graph…</div>
      </WorldChrome>
    );
  }

  return (
    <WorldChrome title="Constellation">
      <div className="relative h-full w-full">
        <div ref={mountRef} className="absolute inset-0" />

        <div className="pointer-events-none absolute inset-0 z-10">
          {catalogForLabels.map((s) => (
            <div
              key={s.id}
              ref={(el) => {
                if (el) labelEls.current.set(s.id, el);
                else labelEls.current.delete(s.id);
              }}
              className="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-[10px] text-zinc-300/90"
              style={{ opacity: 0 }}
            >
              {starLabel(s)}
            </div>
          ))}
        </div>

        <div className="pointer-events-none absolute left-4 top-20 z-30 max-w-sm space-y-3">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.25em] text-white">CONSTELLATION</p>
            <p className="text-xs text-zinc-400">{subtitle}</p>
          </div>
          <div className="pointer-events-auto">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search issues, stars, or templates…"
              className="w-full max-w-xs rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 backdrop-blur-sm outline-none ring-0 focus:border-white/25"
            />
            {graph && (
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setRepoFilter(null)}
                  className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${
                    repoFilter === null ? "bg-white/15 ring-white/30" : "ring-white/10 text-zinc-500"
                  }`}
                >
                  all
                </button>
                {[HERMES_REPO, BUSIEST_REPO].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRepoFilter(r)}
                    className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${
                      repoFilter === r ? "bg-fuchsia-500/20 ring-fuchsia-400/40 text-fuchsia-100" : "ring-white/10 text-zinc-500"
                    }`}
                  >
                    {shortRepo(r)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {(hovered || selected) && (hovered ?? selected)!.kind === "catalog" && (
          <div
            className="pointer-events-none absolute z-30 w-72 rounded-lg border border-white/15 bg-black/75 p-4 text-left shadow-xl backdrop-blur-md"
            style={{
              left: "50%",
              top: "42%",
              transform: "translate(-30%, -50%)",
            }}
          >
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">
              {(hovered ?? selected)!.nodeType === "pull_request" ? "Public pull request" : "Public issue"}
            </p>
            <p className="mt-1 text-sm font-medium leading-snug text-white">
              {(hovered ?? selected)!.title ?? "Untitled"}
            </p>
            <p className="mt-2 text-[11px] text-zinc-400">
              #{(hovered ?? selected)!.number} · {relativeOpened((hovered ?? selected)!.created)}
            </p>
            {(hovered ?? selected)!.agentTemplate && (
              <p className="mt-2 text-[10px] text-fuchsia-300">agent template · magenta nebula</p>
            )}
          </div>
        )}
      </div>
    </WorldChrome>
  );
}
