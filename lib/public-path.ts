const EXTERNAL_URL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const NON_HTTP_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function normalizePublicBasePath(basePath: string | undefined | null) {
  const raw = (basePath ?? "").trim();
  if (!raw || raw === "/") return "";
  const path = raw.replace(/^\/+|\/+$/g, "");
  return path ? `/${path}` : "";
}

export function publicAssetPath(
  assetPath: string,
  basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
) {
  if (EXTERNAL_URL.test(assetPath) || NON_HTTP_SCHEME.test(assetPath)) return assetPath;

  const base = normalizePublicBasePath(basePath);
  const asset = assetPath.replace(/^\/+/, "");
  if (!asset) return base ? `${base}/` : "/";
  return `${base}/${asset}`;
}
