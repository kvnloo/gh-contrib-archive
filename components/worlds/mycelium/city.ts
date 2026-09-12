import * as THREE from "three";
import { FOG_COLOR, FOG_DENSITY, glowTexture } from "./materials";
import { makeRng } from "./terrain";

export type CityBuild = {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
};

/**
 * The far vista: a bioluminescent hyphal metropolis of thin spires, hanging
 * bridges and window lights. Scale comes from repo activity counts only, never
 * from any repo name.
 */
export function buildCity(
  weights: number[],
  uniforms: { uTime: { value: number } },
): CityBuild {
  const group = new THREE.Group();
  const rng = makeRng(0x51f7c3);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uDark: { value: new THREE.Color(0x020908) },
      uGlow: { value: new THREE.Color(0x63f5d8) },
      uWarm: { value: new THREE.Color(0xffc27a) },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying float vY;
      varying float vSeed;
      varying vec2 vFaceUv;
      varying float vFogDepth;
      varying vec3 vNormalW;
      void main() {
        vSeed = aSeed;
        vFaceUv = uv;
        vY = position.y + 0.5;
        vec4 world = modelMatrix * instanceMatrix * vec4( position, 1.0 );
        vNormalW = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * normal );
        vec4 mv = viewMatrix * world;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uDark;
      uniform vec3 uGlow;
      uniform vec3 uWarm;
      varying float vY;
      varying float vSeed;
      varying vec2 vFaceUv;
      varying float vFogDepth;
      varying vec3 vNormalW;

      float hash11( float p ) { return fract( sin( p * 127.1 ) * 43758.5453 ); }

      void main() {
        // Structure darkens toward its roots and brightens toward the crown.
        float grad = pow( clamp( vY, 0.0, 1.0 ), 1.5 );

        // Stacked window bands with per-column gaps.
        float row = floor( vY * 46.0 + vSeed * 13.0 );
        float rowMask = step( 0.42, fract( vY * 46.0 + vSeed * 13.0 ) ) * step( fract( vY * 46.0 + vSeed * 13.0 ), 0.86 );
        float col = floor( vFaceUv.x * 6.0 + vSeed * 7.0 );
        float colMask = step( 0.35, hash11( col * 3.7 + row * 1.31 + vSeed * 91.0 ) );
        float flicker = 0.7 + 0.3 * sin( uTime * ( 1.2 + hash11( row + vSeed ) * 2.4 ) + row * 2.3 + vSeed * 30.0 );
        float lights = rowMask * colMask * flicker;

        // Faint vertical hyphae veins running up the shafts.
        float veins = smoothstep( 0.86, 1.0, sin( vFaceUv.x * 42.0 + vSeed * 20.0 ) * 0.5 + 0.5 );

        vec3 col3 = mix( uDark, uDark + uGlow * 0.1, grad );
        // Window light is kept modest: at this distance the spires should read
        // as a filigree of points, and the bloom pass supplies the halation.
        col3 += uGlow * lights * ( 0.28 + grad * 1.1 );
        col3 += uWarm * lights * 0.1 * hash11( vSeed * 17.0 );
        col3 += uGlow * veins * grad * 0.14;
        col3 += uGlow * pow( grad, 4.0 ) * 0.3;

        // Rim light so silhouettes separate in the haze.
        col3 += uGlow * pow( 1.0 - abs( vNormalW.z ), 3.0 ) * grad * 0.08;

        float fogFactor = 1.0 - exp( - uFogDensity * uFogDensity * vFogDepth * vFogDepth );
        col3 = mix( col3, uFogColor, clamp( fogFactor * 0.92, 0.0, 1.0 ) );

        gl_FragColor = vec4( col3, 1.0 );
      }
    `,
  });

  // A compact cathedral of spires straight down the ravine, with smaller
  // outriggers. Concentrating it keeps the vista a bright focal point at the
  // end of the channel instead of a wall of light across the whole frame.
  // Pushed further down the ravine and narrowed: in the target the metropolis
  // is a tall, slender filigree occupying the centre of the vista, not a broad
  // wall of light filling the middle of the frame.
  const clusters = [
    { x: 4.0, z: -94, spreadX: 8, spreadZ: 9, scale: 1.5 },
    { x: 20, z: -88, spreadX: 6, spreadZ: 8, scale: 0.9 },
    { x: -16, z: -92, spreadX: 6, spreadZ: 8, scale: 0.75 },
    { x: 7, z: -122, spreadX: 16, spreadZ: 12, scale: 1.7 },
  ];

  const count = 220;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const spires = new THREE.InstancedMesh(geo, material, count);
  const seeds = new Float32Array(count);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scaleV = new THREE.Vector3();
  const posV = new THREE.Vector3();

  const tops: number[] = [];
  const windows: number[] = [];

  for (let i = 0; i < count; i++) {
    const cluster = clusters[i % clusters.length];
    const w = weights.length ? weights[i % weights.length] : 0.5;
    const gx = (rng() + rng() - 1) * cluster.spreadX;
    const gz = (rng() + rng() - 1) * cluster.spreadZ;
    const height = (10 + w * 30 + rng() * 16) * cluster.scale;
    const thick = (0.32 + rng() * 0.66) * cluster.scale;
    const baseY = -3 + rng() * 1.5;

    posV.set(cluster.x + gx, baseY + height * 0.5, cluster.z + gz);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI);
    scaleV.set(thick, height, thick * (0.7 + rng() * 0.8));
    matrix.compose(posV, quat, scaleV);
    spires.setMatrixAt(i, matrix);
    seeds[i] = rng();

    tops.push(posV.x, baseY + height, posV.z);
    const lights = 3 + Math.floor(rng() * 5);
    for (let k = 0; k < lights; k++) {
      windows.push(
        posV.x + (rng() - 0.5) * thick * 2.2,
        baseY + height * (0.25 + rng() * 0.75),
        posV.z + (rng() - 0.5) * thick * 2.2,
      );
    }
  }
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  spires.instanceMatrix.needsUpdate = true;
  spires.frustumCulled = false;
  group.add(spires);

  const sprite = glowTexture();

  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute("position", new THREE.Float32BufferAttribute(tops, 3));
  group.add(
    new THREE.Points(
      topGeo,
      new THREE.PointsMaterial({
        map: sprite,
        color: 0xbdfff0,
        size: 0.85,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        opacity: 0.34,
      }),
    ),
  );

  const winGeo = new THREE.BufferGeometry();
  winGeo.setAttribute("position", new THREE.Float32BufferAttribute(windows, 3));
  group.add(
    new THREE.Points(
      winGeo,
      new THREE.PointsMaterial({
        map: sprite,
        color: 0x8ff8e2,
        size: 0.32,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        opacity: 0.32,
      }),
    ),
  );

  // Hanging bridges: long shallow catenaries strung between the clusters.
  const bridgeMat = new THREE.MeshBasicMaterial({
    color: 0x123834,
    transparent: true,
    opacity: 0.9,
    fog: true,
  });
  const bridgeGlow = new THREE.MeshBasicMaterial({
    color: 0x4fc8b4,
    transparent: true,
    opacity: 0.05,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  for (let i = 0; i < 9; i++) {
    const y = 3 + rng() * 17;
    const ax = -34 + rng() * 12;
    const bx = 20 + rng() * 26;
    const z0 = -76 - rng() * 26;
    const z1 = z0 + (rng() - 0.5) * 22;
    const sag = 1.5 + rng() * 3.5;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ax, y + sag * 0.6, z0),
      new THREE.Vector3(ax * 0.45 + bx * 0.1, y - sag * 0.5, z0 * 0.6 + z1 * 0.4),
      new THREE.Vector3(bx * 0.5 + ax * 0.1, y - sag * 0.35, z0 * 0.35 + z1 * 0.65),
      new THREE.Vector3(bx, y + sag * 0.5, z1),
    ]);
    const tube = new THREE.TubeGeometry(curve, 64, 0.16 + rng() * 0.22, 6, false);
    group.add(new THREE.Mesh(tube, bridgeMat));
    const halo = new THREE.TubeGeometry(curve, 64, 0.55 + rng() * 0.5, 6, false);
    group.add(new THREE.Mesh(halo, bridgeGlow));
  }

  // Volumetric haze cards that catch the bloom behind the skyline.
  const hazeMat = new THREE.SpriteMaterial({
    map: sprite,
    color: 0x1f9e8a,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.025,
  });
  for (let i = 0; i < 5; i++) {
    const haze = new THREE.Sprite(hazeMat);
    haze.position.set(-12 + rng() * 26, 5 + rng() * 11, -100 - rng() * 18);
    haze.scale.setScalar(18 + rng() * 22);
    group.add(haze);
  }

  return { group, material };
}
