const API_INTERNAL = process.env.API_URL_INTERNAL ?? "http://api:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  devIndicators: false,
  // Same-origin proxy for figure / PDF URLs embedded in the DOM. Embedding an
  // absolute API URL would bake the SSR-only internal host (api:8000) into the
  // server HTML, which the browser can't resolve and which mismatches the
  // client-resolved host on hydration. A relative `/api/*` URL is identical on
  // server and client and reachable from any host. JSON fetches still hit the
  // API directly via resolveBase(), so they bypass this rewrite.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_INTERNAL}/api/:path*` }];
  },
};
export default nextConfig;
