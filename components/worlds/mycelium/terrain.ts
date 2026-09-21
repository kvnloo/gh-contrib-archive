/**
 * Shared terrain field for the mycelium cavern. The same functions drive the
 * ground mesh, prop placement and water depth so nothing floats or sinks.
 */

export const WATER_LEVEL = -1.24;
export const CHANNEL_HALF_WIDTH = 3.2;

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(fx, fy) * amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 1.97;
  }
  return sum;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Height of the cavern floor at a world position. */
export function terrainHeight(x: number, z: number): number {
  const d = Math.abs(x);

  // Meandering stream: the channel wanders slightly with depth.
  const meander = Math.sin(z * 0.055) * 1.9 + Math.sin(z * 0.021 + 1.3) * 1.1;
  const dc = Math.abs(x - meander);

  // Steep cut banks keep the stream narrow, as in a real incised channel.
  const bank = Math.pow(smoothstep(CHANNEL_HALF_WIDTH * 0.4, 6.5, dc), 1.25) * 2.8;
  const walls = Math.pow(smoothstep(13, 34, d), 1.6) * 12.0;

  // Foreground banks rise to frame the shot without blocking the vista. They
  // start closer to the camera and climb harder than the mid-ground so the
  // lower corners of the frame fall away into black earth.
  const frame = smoothstep(-4, 16, z) * Math.pow(smoothstep(3.2, 12, dc), 1.1) * 3.4;

  // Crumbly ridge-lines along the cut banks: the silhouette edge that separates
  // the dark foreground from the lit vista needs to be ragged, not a smooth arc.
  const ridge = fbm(x * 0.055 + 11, z * 0.045 + 4) * 3.1 * smoothstep(1.6, 8, dc);
  const ridgeCrest =
    Math.pow(fbm(x * 0.11 + 61, z * 0.08 + 23), 1.6) * 2.2 * smoothstep(4.0, 12, dc);
  const boulders = Math.pow(fbm(x * 0.16 + 31, z * 0.14 + 7), 2.0) * 1.8 * smoothstep(2.0, 7, dc);
  const detail = (fbm(x * 0.55 + 3, z * 0.5 + 19) - 0.5) * 0.52;
  const clods = Math.pow(fbm(x * 1.05 + 71, z * 0.95 + 13), 2.4) * 0.42 * smoothstep(1.4, 5, dc);
  const grit = (fbm(x * 2.1, z * 1.9) - 0.5) * 0.13;

  // Gentle fall toward the camera so the water reads as flowing outward.
  const fall = -z * 0.012;

  return (
    -2.05 + bank + walls + frame + ridge + ridgeCrest + boulders + detail + clods + grit + fall
  );
}

/** 0 in the dry uplands, 1 in the wet stream bed. */
export function wetness(x: number, z: number): number {
  const h = terrainHeight(x, z);
  return 1 - smoothstep(WATER_LEVEL - 0.05, WATER_LEVEL + 1.5, h);
}

export function streamCenter(z: number): number {
  return Math.sin(z * 0.055) * 1.9 + Math.sin(z * 0.021 + 1.3) * 1.1;
}

/** Deterministic pseudo-random stream so layout is stable between renders. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
