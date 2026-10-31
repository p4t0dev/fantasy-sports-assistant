// Light, dark, or whatever the system says. The choice is a reading preference
// and stays in this browser, like the folded sections.

export type ThemePreference = "light" | "dark" | "system";

const THEME_KEY = "fsa_theme";

// Runs inline in <head>, before the first paint: the page is a static export
// and cannot know the choice, so anything later would flash the wrong theme.
// It stays alive to follow the system at night, and re-applies on `storage`,
// which is also how `setThemePreference` reaches it.
export const THEME_SCRIPT = `(function () {
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    var stored = null;
    try { stored = window.localStorage.getItem("${THEME_KEY}"); } catch (e) {}
    var dark = stored === "dark" || (stored !== "light" && media.matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }
  apply();
  media.addEventListener("change", apply);
  window.addEventListener("storage", apply);
})();`;

export function subscribeToTheme(listener: () => void) {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* no storage: the system decides */
  }
  return "system";
}

export function getThemeServerPreference(): ThemePreference {
  return "system";
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, preference);
  } catch {
    return;
  }
  // `storage` only fires in other tabs on its own.
  window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY }));
}
