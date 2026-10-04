export function isSceneCaptureMode(search: string) {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(query).get("capture") === "scene";
}

export function sceneCaptureTime(captureMode: boolean, elapsedSeconds: number) {
  return captureMode ? 0 : elapsedSeconds;
}
