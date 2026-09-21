export const CINEMA_LOOKS = ['midnight', 'moonlit', 'ember', 'verdant'] as const;
export type CinemaLook = (typeof CINEMA_LOOKS)[number];

export function cinemaProfile(width: number, pixelRatio: number, reducedMotion: boolean, look: string = 'midnight') {
  const phone = !Number.isFinite(width) || width < 768;
  const dpr = Number.isFinite(pixelRatio) ? Math.max(1, pixelRatio) : 1;
  const looks = {
    midnight: { exposure: 0.76, coolLightScale: 0.18, warmLightScale: 0.65 },
    moonlit: { exposure: 0.68, coolLightScale: 0.12, warmLightScale: 0.4 },
    ember: { exposure: 0.8, coolLightScale: 0.12, warmLightScale: 0.95 },
    verdant: { exposure: 0.72, coolLightScale: 0.28, warmLightScale: 0.5 },
  };
  const selected = CINEMA_LOOKS.includes(look as CinemaLook) ? look as CinemaLook : 'midnight';
  return {
    ...looks[selected],
    look: selected,
    pixelRatio: Math.min(dpr, phone ? 1.25 : 1.75),
    terrainSegments: phone ? 90 : 180,
    reflectionSize: phone ? 256 : 512,
    sporeCount: phone ? 180 : 360,
    colonyLimit: phone ? 150 : 260,
    fps: phone ? 30 : 60,
    fov: phone ? 68 : 56,
    autoplay: !reducedMotion,
  };
}

export function advanceSceneTime(time: number, delta: number, playing: boolean): number {
  return playing ? time + Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 0.05)) : time;
}

export function shouldRenderFrame(now: number, previous: number, fps: number, hidden: boolean): boolean {
  return !hidden && now - previous >= 1000 / Math.max(1, fps);
}
