import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // firebase-admin is server-only; keep it out of the client bundle.
  serverExternalPackages: ["firebase-admin"],
  output: "standalone",
};

export default nextConfig;
