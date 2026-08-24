/**
 * Plain-JS config: Next 15's TypeScript config loader uses tsc internals
 * that no longer exist under TypeScript 7 (this repo's standard), so the
 * config ships as .mjs instead of .ts.
 *
 * Webpack pipeline is pinned via `--webpack` in package.json scripts because
 * this repo keeps NodeNext-style `.js`-suffixed relative imports; webpack
 * needs resolve.extensionAlias below to map them onto ./.ts sources.
 * Turbopack (Next 16 default) has no equivalent and fails the same imports.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
