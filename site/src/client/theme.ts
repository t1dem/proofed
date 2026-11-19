export type Theme = "dark" | "light";
const THEME_KEY = "proofed-theme";

export function storedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Keep the theme for the current page when storage is blocked.
  }
}
