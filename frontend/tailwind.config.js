/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#07080A", surface: "#0D0F13", panel: "#12151B", line: "#1F242D",
        ink: "#E8EAED", muted: "#8A93A3", red: "#FF2D3A", amber: "#FFB020",
        green: "#22D37A", cyan: "#38D9F5",
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
