const generatedArtifactPaths =
  /(^|[\\/])(\.playwright-cli|\.next[\\/]playwright-cli|output[\\/]playwright|tsconfig\.tsbuildinfo)([\\/]|$)/;
const generatedArtifactGlobs = [
  '**/.playwright-cli/**',
  '**/.next/playwright-cli/**',
  '**/output/playwright/**',
  '**/tsconfig.tsbuildinfo',
];

function mergeIgnoredWatchPaths(ignored) {
  if (!ignored) {
    return generatedArtifactPaths;
  }

  if (ignored instanceof RegExp) {
    return new RegExp(`(?:${ignored.source})|(?:${generatedArtifactPaths.source})`);
  }

  if (Array.isArray(ignored) && ignored.every((item) => typeof item === 'string')) {
    return [...ignored, ...generatedArtifactGlobs];
  }

  if (typeof ignored === 'string') {
    return [ignored, ...generatedArtifactGlobs];
  }

  return generatedArtifactPaths;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // When you access the dev server from another device / by LAN IP,
  // Next.js may block HMR websocket requests for safety unless allowed.
  allowedDevOrigins: ['192.168.1.232', 'localhost', '127.0.0.1'],
  turbopack: {},
  webpack(config) {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: mergeIgnoredWatchPaths(config.watchOptions?.ignored),
    };

    return config;
  },
};

module.exports = nextConfig;
