import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: false,
  images: { unoptimized: true },
  transpilePackages: ['@hfs/schemas'],
};

export default nextConfig;
