import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  async rewrites() {
    const origin = new URL(process.env.API_INTERNAL_ORIGIN || "http://localhost:4000");
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password ||
        origin.pathname !== "/" || origin.search || origin.hash) {
      throw new Error("API_INTERNAL_ORIGIN must be an HTTP(S) origin without credentials or a path.");
    }
    return [{ source: "/api/:path*", destination: `${origin.origin}/api/:path*` }];
  },
};
export default nextConfig;
