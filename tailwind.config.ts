import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: "class",
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                // Device-native system font stack: SF Pro on Apple, Segoe UI on
                // Windows, Roboto on Android, Noto Sans / Liberation Sans on
                // Linux — with Arial and generic sans-serif as final fallbacks.
                sans: [
                    "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto",
                    "Helvetica Neue", "Noto Sans", "Liberation Sans", "Arial",
                    "sans-serif", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol",
                ],
            },
            keyframes: {
                ytSectionReveal: {
                    "0%": { opacity: "0", transform: "translateY(10px)" },
                    "100%": { opacity: "1", transform: "translateY(0)" },
                },
                ytSkeletonShimmer: {
                    "0%, 100%": { opacity: "0.45" },
                    "50%": { opacity: "0.85" },
                },
            },
            animation: {
                "yt-section-reveal": "ytSectionReveal 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
                "yt-skeleton": "ytSkeletonShimmer 1.2s ease-in-out infinite",
            },
        },
    },
    plugins: [],
};

export default config;
