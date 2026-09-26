/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@eventra/contracts"],
  webpack: (config) => {
    return config;
  },
};

export default nextConfig;
