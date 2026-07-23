import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ─── Lint config ────────────────────────────────────────────────────────────
// We start from Next.js's recommended preset, then make a few stylistic
// rules advisory rather than blocking. Hundreds of files in this repo use
// `any` for ad-hoc types and several effects assign state directly — fixing
// every instance is a separate cleanup pass; surfacing them as warnings
// keeps the signal without breaking CI.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Skip generated output, third-party JS scripts, Prisma client, and the
  // legacy ad-hoc patch scripts at the repo root (they use CommonJS).
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Root-level ad-hoc scripts use CommonJS `require()` — keep them out
    // of the lint pass instead of fighting the no-require-imports rule.
    "debug-rating.js",
    "fix_*.js",
    "patch_*.js",
    "scripts/**/*.js",
    // Generated Prisma client — no value in linting it.
    "node_modules/**",
    "prisma/migrations/**",
  ]),

  // Project-wide rule overrides — downgrade noisy stylistic rules to
  // warnings so they don't block CI but still show up locally.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",  // accessing .current during render is intentional in some places
      "react/no-unescaped-entities": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "prefer-const": "warn",
    },
  },

  // .ts scripts: allow looser typing — they're internal one-offs.
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
