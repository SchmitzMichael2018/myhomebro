const FONT_THEME_OPTIONS = [
  { value: "clean_sans", label: "Clean Sans", family: 'ui-sans-serif, system-ui, sans-serif' },
  { value: "modern_sans", label: "Modern Sans", family: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  { value: "editorial_serif", label: "Editorial Serif", family: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' },
  { value: "warm_serif", label: "Warm Serif", family: 'Georgia, Cambria, "Times New Roman", serif' },
  { value: "compact_sans", label: "Compact Sans", family: 'Arial Narrow, ui-sans-serif, system-ui, sans-serif' },
];

const THEME_OPTIONS = [
  { value: "modern", label: "Modern" },
  { value: "professional", label: "Professional" },
  { value: "minimal", label: "Minimal" },
  { value: "bold", label: "Bold" },
  { value: "warm", label: "Warm" },
];

const THEME_PRESETS = {
  modern: {
    label: "Modern",
    hero: "linear-gradient(135deg, #0f172a 0%, #0f766e 52%, #38bdf8 100%)",
    card: "#ffffff",
    accent: "#0f766e",
    badge: "#e0f2fe",
    text: "#ffffff",
    mutedText: "#e2e8f0",
    nameChip: "#ffffff",
    nameChipText: "#0f172a",
    cta: "#0f172a",
    ctaText: "#ffffff",
  },
  professional: {
    label: "Professional",
    hero: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 55%, #334155 100%)",
    card: "#ffffff",
    accent: "#1d4ed8",
    badge: "#dbeafe",
    text: "#ffffff",
    mutedText: "#e2e8f0",
    nameChip: "#ffffff",
    nameChipText: "#0f172a",
    cta: "#1d4ed8",
    ctaText: "#ffffff",
  },
  minimal: {
    label: "Minimal",
    hero: "linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)",
    card: "#ffffff",
    accent: "#475569",
    badge: "#e2e8f0",
    text: "#0f172a",
    mutedText: "#475569",
    nameChip: "#f8fafc",
    nameChipText: "#0f172a",
    cta: "#0f172a",
    ctaText: "#ffffff",
  },
  bold: {
    label: "Bold",
    hero: "linear-gradient(135deg, #111827 0%, #be123c 55%, #7c3aed 100%)",
    card: "#ffffff",
    accent: "#be123c",
    badge: "#fee2e2",
    text: "#ffffff",
    mutedText: "#e5e7eb",
    nameChip: "#ffffff",
    nameChipText: "#111827",
    cta: "#be123c",
    ctaText: "#ffffff",
  },
  warm: {
    label: "Warm",
    hero: "linear-gradient(135deg, #451a03 0%, #c2410c 55%, #f59e0b 100%)",
    card: "#ffffff",
    accent: "#c2410c",
    badge: "#ffedd5",
    text: "#ffffff",
    mutedText: "#ffedd5",
    nameChip: "#ffffff",
    nameChipText: "#451a03",
    cta: "#c2410c",
    ctaText: "#ffffff",
  },
};

const FONT_THEME_MAP = FONT_THEME_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item.family;
  return acc;
}, {});

function normalizeHexColor(value, fallback) {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(text) || /^#[0-9a-fA-F]{6}$/.test(text)) return text;
  return fallback;
}

function hexToRgb(hex) {
  const text = normalizeHexColor(hex, "");
  if (!text) return null;
  const value = text.slice(1);
  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  const int = Number.parseInt(normalized, 16);
  if (!Number.isFinite(int)) return null;
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function getContrastTextColor(hex, fallback = "#ffffff") {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.62 ? "#0f172a" : "#ffffff";
}

function getThemePreset(value) {
  return THEME_PRESETS[String(value || "").toLowerCase()] || THEME_PRESETS.modern;
}

export function getPublicProfileBranding(profile = {}) {
  const theme = getThemePreset(profile.profile_theme);
  const primary = normalizeHexColor(profile.brand_primary_color, theme.accent);
  const accent = normalizeHexColor(profile.brand_accent_color, primary);
  const fontFamily = FONT_THEME_MAP[String(profile.brand_font_theme || "").toLowerCase()] || FONT_THEME_MAP.clean_sans;
  const textColor = theme.text || getContrastTextColor(primary);
  const onPrimary = getContrastTextColor(primary, theme.ctaText);
  const onAccent = getContrastTextColor(accent, theme.ctaText);

  return {
    theme: theme.label,
    themeKey: String(profile.profile_theme || "modern").toLowerCase(),
    primary,
    accent,
    fontFamily,
    textColor,
    onPrimary,
    onAccent,
    heroBackground: theme.hero,
    cardBackground: theme.card,
    badgeBackground: theme.badge,
    heroChipBackground: theme.nameChip,
    heroChipText: theme.nameChipText,
    ctaBackground: theme.cta,
    ctaText: theme.ctaText,
  };
}

export function buildPublicProfileThemeStyle(profile = {}) {
  const branding = getPublicProfileBranding(profile);
  return {
    fontFamily: branding.fontFamily,
    "--mhb-public-primary": branding.primary,
    "--mhb-public-accent": branding.accent,
    "--mhb-public-on-primary": branding.onPrimary,
    "--mhb-public-on-accent": branding.onAccent,
  };
}

export { FONT_THEME_OPTIONS, THEME_OPTIONS, normalizeHexColor };
