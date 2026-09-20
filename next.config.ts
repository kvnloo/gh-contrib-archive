import type { NextConfig } from "next";
import { normalizePublicBasePath } from "./lib/public-path";

const basePath = normalizePublicBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

const nextConfig: NextConfig = {
  basePath,
  serverExternalPackages: ["node:sqlite"],
};

export default nextConfig;
