export function isVisualVerifyMode() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("verify") === "1";
}

export function makeSeededRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sceneRng(seed: number) {
  return isVisualVerifyMode() ? makeSeededRng(seed) : Math.random;
}
