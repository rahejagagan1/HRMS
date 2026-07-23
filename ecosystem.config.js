module.exports = {
  apps: [
    {
      name: "nb-dashboard",
      script: "node_modules/next/dist/bin/next",
      // Serve the PRODUCTION build (`npm run build` output) — NOT `next dev`.
      // `next dev` recompiles every route on first hit (5-10s) and ships
      // unminified JS; `next start` serves the prebuilt, minified output so
      // pages render in ~100-300ms. Run `npm run build` before each restart.
      args: "start -H 0.0.0.0 -p 3005",
      cwd: __dirname,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
