import type { GrytTheme } from "@gryt/ui";
import { createGrytTheme, grytDraft, grytThemeToOptions } from "@gryt/ui";

export type ThemeStyle = "kirilie" | "original";

/** A separate preference: switching styles never rewrites the original palette. */
export function readThemeStyle(storage: Pick<Storage, "getItem">): ThemeStyle {
  return storage.getItem("theme.style") === "original" ? "original" : "kirilie";
}

const hues = {
  accent: "#d3e994", accentLight: "#c5de7c",
  secondary: "#f5d87d", secondaryLight: "#eed074",
  success: "#47682e", danger: "#b64e43", dangerLight: "#a13f36",
  warning: "#e7bc52", onAccent: "#304224", onSecondary: "#51401d",
  onDanger: "#fffaf0",
};

/** Original artwork and palette inspired by a soft crayon garden on cream paper. */
export const kirilieTheme: GrytTheme = {
  ...grytDraft,
  name: "手绘奇丽叶",
  hue: hues,
  lightHue: hues,
  light: {
    bg: "#faf8ee", surface: "#fffdf4", surfaceRaised: "#f3f5df",
    surfaceHover: "#e9efcf", border: "#b7b99a", muted: "#626b50", text: "#35402b",
  },
  radius: { sm: 7, md: 12, lg: 19, xl: 24, full: 18 },
};

/** Editor previews temporarily take priority, while the saved style stays intact. */
export function resolveDisplayedTheme(
  style: ThemeStyle,
  appearance: "light" | "dark",
  active: GrytTheme | null,
  draft: GrytTheme | null,
) {
  const handDrawn = style === "kirilie" && draft === null;
  return {
    handDrawn,
    appearance: handDrawn ? "light" as const : appearance,
    theme: draft ?? (handDrawn ? kirilieTheme : active),
  };
}

export function kirilieThemeVariables(): Record<string, string> {
  const variables = createGrytTheme(grytThemeToOptions(kirilieTheme, "light")) as Record<string, string>;
  // Text and focus anchors remain darker than the decorative crayon fills.
  const anchors = {
    "accent-8": "#718746", "accent-11": "#496326", "accent-12": "#304224",
    "secondary-11": "#745923", "secondary-12": "#51401d",
    "success-11": "#47682e", "danger-11": "#a13f36", "warning-11": "#745923",
    unread: "#b64e43", "on-unread": "#fffaf0",
  };
  for (const [name, value] of Object.entries(anchors)) {
    variables[`--gryt-${name}`] = value;
    variables[`--color-gryt-${name}`] = value;
  }
  return variables;
}
