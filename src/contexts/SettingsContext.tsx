import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { commands } from "@/lib/bindings";
import {
  DEFAULTS,
  Settings,
  entriesToSettings,
  keyForField,
  serialize,
} from "@/lib/settings";

interface SettingsContextValue {
  settings: Settings;
  loaded: boolean;
  set: <K extends keyof Settings>(field: K, value: Settings[K]) => Promise<void>;
  setMany: (partial: Partial<Settings>) => Promise<void>;
  reload: () => Promise<void>;
  resetAll: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

// Preset themes (Solarized / Nord / …) are full palettes that layer on top of a
// light or dark *base family*. `data-theme` carries the family — so every
// existing `[data-theme="dark"]` rule (code editor, hljs, scrollbars, glass)
// keeps working — while `data-preset` repaints the surfaces + accent on top
// (tokens.css / App.css). Plain light/dark/system set no `data-preset`.
const PRESET_FAMILY: Record<string, "light" | "dark"> = {
  solarized: "light",
  sepia: "light",
  nord: "dark",
  dracula: "dark",
  "high-contrast": "dark",
};

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await commands.settingsGetAll();
    if (res.status === "ok") {
      setSettings(entriesToSettings(res.data));
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const set = useCallback(
    async <K extends keyof Settings>(field: K, value: Settings[K]) => {
      setSettings((prev) => ({ ...prev, [field]: value }));
      await commands.settingsSet(keyForField(field), serialize(field, value));
    },
    []
  );

  const setMany = useCallback(async (partial: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    const entries: Array<[string, string]> = (
      Object.entries(partial) as Array<[keyof Settings, Settings[keyof Settings]]>
    ).map(([field, value]) => [keyForField(field), serialize(field, value)]);
    if (entries.length > 0) {
      await commands.settingsSetMany(entries);
    }
  }, []);

  const resetAll = useCallback(async () => {
    setSettings(DEFAULTS);
    const entries = (Object.keys(DEFAULTS) as Array<keyof Settings>).map(
      (field) => [keyForField(field), serialize(field, DEFAULTS[field])] as [string, string]
    );
    await commands.settingsSetMany(entries);
  }, []);

  // --- Theme application: set the `data-theme` attribute on <html> from the
  // theme setting. Decision A (2026-05-31): SettingsContext is the single
  // source of truth for theme. PR-UI 8b dropped the parallel legacy `.dark`
  // class — shadcn now themes through `[data-theme="dark"]` too (App.css var
  // blocks + custom-variant), so a single attribute drives everything.
  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const preset = PRESET_FAMILY[settings.theme] ? settings.theme : null;
    const apply = () => {
      let family: "light" | "dark";
      if (preset) {
        family = PRESET_FAMILY[preset];
      } else if (settings.theme === "system") {
        family = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      } else {
        family = settings.theme === "dark" ? "dark" : "light";
      }
      root.setAttribute("data-theme", family);
      if (preset) root.setAttribute("data-preset", preset);
      else root.removeAttribute("data-preset");
    };
    apply();
    // Only "system" tracks the OS — a fixed preset/light/dark doesn't.
    if (settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [settings.theme, loaded]);

  // Accent palette: `data-accent` overrides the --accent* tokens (tokens.css)
  // over whichever light/dark mode is active. "green" is the base (no override),
  // so any selection just swaps which `[data-accent="…"]` block wins. Preset
  // themes ship their own accent, so we drop `data-accent` while one is active.
  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    if (PRESET_FAMILY[settings.theme]) root.removeAttribute("data-accent");
    else root.setAttribute("data-accent", settings.colorTheme);
  }, [settings.colorTheme, settings.theme, loaded]);

  // App-wide UI scale: native webview zoom (like browser ⌘+/−). Unlike CSS
  // `zoom`, this reflows the page natively, so pixel-measuring components
  // (xterm terminal, React Flow graph, charts) stay correct instead of breaking.
  // Webview zoom resets on reload, so we re-apply on mount + whenever it changes.
  // Clamped so a bad value can't lock the user out. No-op outside Tauri.
  useEffect(() => {
    if (!loaded) return;
    const scale = Math.min(1.6, Math.max(0.7, settings.uiScale || 1));
    try {
      // getCurrentWebview() throws synchronously outside Tauri (tests / web
      // preview); setZoom() may reject — both are ignored as a no-op.
      void getCurrentWebview()
        .setZoom(scale)
        .catch(() => {});
    } catch {
      /* not running under Tauri — ignore */
    }
  }, [settings.uiScale, loaded]);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, loaded, set, setMany, reload, resetAll }),
    [settings, loaded, set, setMany, reload, resetAll]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used inside <SettingsProvider>.");
  }
  return ctx;
}
