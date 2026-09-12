import * as THREE from "three";

export const FOG_COLOR = 0x040e10;
export const FOG_DENSITY = 0.0105;

/**
 * Soft radial glow sprite used for mushroom haloes and spire lights.
 *
 * The falloff is deliberately tight: a wide, soft gradient multiplied across
 * hundreds of additive sprites is what turns a dark cavern into flat fog, so
 * the energy is kept in a small core with a fast shoulder.
 */
export function glowTexture(inner = "rgba(226,255,248,1)", outer = "rgba(40,210,180,0)"): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.1, "rgba(170,255,236,0.5)");
  g.addColorStop(0.26, "rgba(60,220,190,0.13)");
  g.addColorStop(0.55, "rgba(40,190,165,0.03)");
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Small elongated spore mote. */
export function moteTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(190,255,242,0.45)");
  g.addColorStop(0.45, "rgba(130,255,225,0.06)");
  g.addColorStop(1, "rgba(120,255,220,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function loadTiling(
  loader: THREE.TextureLoader,
  url: string,
  repeat: number,
  srgb: boolean,
): THREE.Texture {
  const tex = loader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Wet-ground patch: low-lying soil near the stream turns glossy and picks up a
 * faint bioluminescent bleed from the water, dry uplands stay matte and black.
 */
export function patchWetGround(
  material: THREE.MeshStandardMaterial,
  waterLevel: number,
  uniforms: { uTime: { value: number } },
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWaterLevel = { value: waterLevel };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWorldPosM;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWorldPosM = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform float uWaterLevel;
        varying vec3 vWorldPosM;
        float hashM( vec2 p ) {
          return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
        }
        float noiseM( vec2 p ) {
          vec2 i = floor( p ); vec2 f = fract( p );
          vec2 u = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( hashM( i ), hashM( i + vec2( 1.0, 0.0 ) ), u.x ),
                      mix( hashM( i + vec2( 0.0, 1.0 ) ), hashM( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        // Wet soil is *darker* and glossier than dry soil, not brighter. Getting
        // this the right way round is what keeps the banks reading as black earth
        // with specular highlights instead of a uniform glowing wash.
        float wetBand = 1.0 - smoothstep( uWaterLevel - 0.1, uWaterLevel + 1.15, vWorldPosM.y );
        float puddleN = noiseM( vWorldPosM.xz * 0.55 );
        float wet = clamp( wetBand * ( 0.55 + 0.65 * puddleN ), 0.0, 1.0 );
        diffuseColor.rgb *= mix( 1.0, 0.55, wet );`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, 0.055, wet * 0.96 );`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
        metalnessFactor = mix( metalnessFactor, 0.28, wet * 0.85 );`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // Bioluminescent film clinging to the rock: sparse threads, not a glow
        // field. Thresholded hard so it reads as discrete veins at the waterline.
        float veinN = noiseM( vWorldPosM.xz * 2.6 + vec2( 0.0, uTime * 0.05 ) );
        float veins = smoothstep( 0.78, 0.99, veinN ) * wet;
        float rim = ( 1.0 - smoothstep( uWaterLevel - 0.05, uWaterLevel + 0.18, vWorldPosM.y ) );
        totalEmissiveRadiance += vec3( 0.05, 0.42, 0.35 ) * ( veins * 0.22 + rim * 0.1 )
          * ( 0.8 + 0.2 * sin( uTime * 0.9 + vWorldPosM.z * 0.4 ) );`,
      );
  };
  material.needsUpdate = true;
}

/**
 * Instanced emissive props (mushroom caps/stems): per-instance tint plus a
 * per-instance breathing shimmer driven by an `aSeed` attribute.
 */
export function patchInstancedGlow(
  material: THREE.MeshStandardMaterial,
  uniforms: { uTime: { value: number } },
  opts: { amount?: number; speed?: number; gills?: number; rim?: number } = {},
) {
  const amount = opts.amount ?? 0.3;
  const speed = opts.speed ?? 1.4;
  // Real bioluminescent fungi emit from the gills and the cap rim, so the
  // silhouette stays dark on top. That contrast is what keeps a field of
  // mushrooms from bloom-merging into one white mass.
  const gills = opts.gills ?? 0.0;
  const rim = opts.rim ?? 0.0;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aSeed;
        varying float vSeed;
        varying vec3 vGlowNormalW;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vSeed = aSeed;`,
      )
      .replace(
        "#include <defaultnormal_vertex>",
        `#include <defaultnormal_vertex>
        // transformedNormal already folds in instanceMatrix; the view matrix is
        // orthonormal, so a row-vector multiply takes it back to world space.
        vGlowNormalW = normalize( ( vec4( transformedNormal, 0.0 ) * viewMatrix ).xyz );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        varying float vSeed;
        varying vec3 vGlowNormalW;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float shimmer = 1.0 + ${amount.toFixed(3)} * sin( uTime * ${speed.toFixed(3)} + vSeed * 6.2831 );
        // Downward-facing surfaces (gills) glow, the upward cap crown is dimmed.
        float down = clamp( -vGlowNormalW.y, 0.0, 1.0 );
        float up = clamp( vGlowNormalW.y, 0.0, 1.0 );
        float sideRim = pow( 1.0 - abs( vGlowNormalW.y ), 3.0 );
        float shape = 1.0
          + ${gills.toFixed(3)} * down
          + ${rim.toFixed(3)} * sideRim
          - ${(gills * 0.55).toFixed(3)} * pow( up, 1.5 );
        totalEmissiveRadiance *= shimmer * max( shape, 0.06 );`,
      );
  };
  material.needsUpdate = true;
}
