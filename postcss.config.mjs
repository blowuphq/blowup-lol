/**
 * Required for Tailwind v4 under Next 16: without a postcss config, Next
 * never loads @tailwindcss/postcss, so @import 'tailwindcss' gets inlined
 * as raw source CSS (@theme/@tailwind at-rules reach the browser untouched).
 *
 * See node_modules/next/dist/docs/01-app/01-getting-started/11-css.md.
 *
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
