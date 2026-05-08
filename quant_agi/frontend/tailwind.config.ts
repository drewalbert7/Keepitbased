import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#04050a",
        panel: "#0c1020",
        panelAlt: "#12182b",
        neon: "#8b5cf6",
        mint: "#34d399",
        warn: "#f97316",
        danger: "#f43f5e"
      }
    }
  },
  plugins: []
} satisfies Config;
