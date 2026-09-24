import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // server.mjs rewrites the HTML stream to inject the YouTube Playables SDK
  // as the first <head> script; built-in gzip would hide the bytes from it.
  // (The external Caddy proxy re-compresses for real clients.)
  compress: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  // Standalone output is ONLY for container deploys that run
  // `.next/standalone/server.js` (e.g. the AI Studio Cloud Run pipeline — set
  // NEXT_OUTPUT_STANDALONE=1 there). This repo's production path is the
  // custom server.mjs (bun/node) which reads the root `.next/` directly, so
  // the default skips the standalone copy: faster builds, less disk, and no
  // "next start does not work with output: standalone" warning on boot.
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' ? 'standalone' : undefined,
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
