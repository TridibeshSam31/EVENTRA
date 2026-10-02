/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@eventra/contracts"],
  experimental: {
    turbo: {},
  },
};

export default nextConfig;
