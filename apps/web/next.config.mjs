/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disabled in dev to prevent double-render slowdown; enable for production
  reactStrictMode: false,

  transpilePackages: ["@eventra/contracts"],

  // Skip type-checking and linting during `next dev` — run these separately
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  experimental: {
    turbo: {
      // Turbopack-specific tree-shaking for heavy packages
      resolveAlias: {},
    },
    // Tree-shake these heavy packages properly (huge compile speedup)
    optimizePackageImports: [
      "framer-motion",
      "lucide-react",
      "@base-ui/react",
      "d3-scale",
      "react-simple-maps",
    ],
  },
};

export default nextConfig;

