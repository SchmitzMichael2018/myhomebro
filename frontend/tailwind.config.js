const defaultTheme = require("tailwindcss/defaultTheme");
const typography = require("@tailwindcss/typography");
const forms = require("@tailwindcss/forms");

module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx,vue}",
    "./public/index.html",
  ],
  safelist: [
    {
      pattern: /(bg|text|border)-(primary|secondary|accent|danger|warning|info|dark|light|gray)(-(light|dark|[0-9]+))?/,
    },
  ],
  theme: {
    extend: {
      colors: {
        // Custom palette (no need to override gray!)
        primary: {
          DEFAULT: "#1E3A8A",
          light: "#3B82F6",
          dark: "#1E293B",
          contrast: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "#D97706",
          light: "#F59E0B",
          dark: "#B45309",
          contrast: "#FFFFFF",
        },
        accent: "#22C55E",
        danger: "#DC2626",
        warning: "#FBBF24",
        info: "#3B82F6",
        dark: "#1F2937",
        light: "#F9FAFB",
        white: "#fff",
        black: "#000",
      },
      fontFamily: {
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
        serif: [...defaultTheme.fontFamily.serif],
        mono: [...defaultTheme.fontFamily.mono],
      },
      // ...any other extensions
    },
  },
  plugins: [
    typography,
    forms,
  ],
};










