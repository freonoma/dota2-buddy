/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark, Dota-flavored palette tuned for second-monitor glance use.
        bg: {
          DEFAULT: "#0b0d12",
          panel: "#13171f",
          elevated: "#1a1f2a",
          hover: "#222837",
        },
        accent: {
          DEFAULT: "#e8a33d",
          dim: "#a6741f",
        },
        ally: "#3ea66f",
        enemy: "#c64545",
        ban: "#5a5a5a",
        muted: "#6c7689",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
