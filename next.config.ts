import type { NextConfig } from "next";
import { normalizePublicBasePath } from "./lib/public-path";

const basePath = normalizePublicBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

const nextConfig: NextConfig = {
  basePath,
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
