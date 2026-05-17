// Tailwind v4 ships the PostCSS plugin as a separate package — using
// `tailwindcss` directly is no longer supported. v4 also bundles
// autoprefixer-equivalents internally, so the standalone autoprefixer
// plugin is no longer required.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
