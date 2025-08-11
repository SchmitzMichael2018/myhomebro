// tailwind.config.js

const defaultTheme = require("tailwindcss/defaultTheme");
const typography = require("@tailwindcss/typography");
const forms = require("@tailwindcss/forms");

module.exports = {
  // The `content` array is correctly configured to scan all your
  // component and HTML files for utility classes.
  content: [
    "./src/**/*.{js,jsx,ts,tsx,vue}",
    "./public/index.html",
  ],

  // The `safelist` is a powerful feature used correctly here.
  // See the summary below for more details on this.
  safelist: [
    {
      pattern: /(bg|text|border)-(primary|secondary|accent|danger|warning|info|dark|light|gray)(-(light|dark|[0-9]+))?/,
    },
  ],

  // Using `theme.extend` is the correct way to add to Tailwind's
  // default theme without overwriting it entirely.
  theme: {
    extend: {
      // This is a fantastic way to structure a color palette. Defining DEFAULT,
      // light, dark, and contrast shades makes your theme very robust.
      colors: {
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
        // It's good practice to explicitly define white and black as well.
        white: "#fff",
        black: "#000",
      },
      // Correctly extending the default font stack to add "Inter".
      fontFamily: {
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
        serif: [...defaultTheme.fontFamily.serif],
        mono: [...defaultTheme.fontFamily.mono],
      },
    },
  },

  // Correctly including the official typography and forms plugins.
  plugins: [
    typography,
    forms,
  ],
};