import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tier: {
          gold: "#d4af37",
          silver: "#c0c0c0",
          bronze: "#cd7f32",
        },
        ink: {
          DEFAULT: "#0e0e10",
          soft: "#1a1a1d",
          line: "#2a2a30",
        },
      },
      boxShadow: {
        "tier-gold": "0 0 0 2px #d4af37, 0 0 16px rgba(212,175,55,0.45)",
        "tier-silver": "0 0 0 2px #c0c0c0, 0 0 14px rgba(192,192,192,0.40)",
        "tier-bronze": "0 0 0 2px #cd7f32, 0 0 12px rgba(205,127,50,0.40)",
      },
    },
  },
  plugins: [],
};

export default config;
