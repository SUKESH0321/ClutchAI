/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#1c070b", surface: "#2c0d13", panel: "#3a141c", line: "#6a2431",
        ink: "#fff4f1", muted: "#cfb0b4", red: "#ff3b47", amber: "#ffb020",
        green: "#2fe08a", cyan: "#4fe0f7",
        soft: "#FF3B3B", medium: "#FFD12E", hard: "#EDEDED", wet: "#2F8BFF",
      },
      fontFamily: {
        display: ['"Barlow Condensed"', "Impact", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
