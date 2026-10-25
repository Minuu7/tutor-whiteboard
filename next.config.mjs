/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevents double-mounting Tldraw + Realtime channels in dev
  reactStrictMode: false,
  transpilePackages: ['tldraw'],
  webpack: (config) => {
    // pdfjs-dist optionally requires the node `canvas` package; disable it
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
