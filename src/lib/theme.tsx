// Thin compatibility shim — the canonical theme state now lives in
// SettingsContext. This file is kept so that existing `useTheme()` call sites
// keep working.

import { useEffect, useState } from "react";
import { useSettings } from "@/contexts/SettingsContext";

export type Theme = "light" | "dark" | "system";

export function useTheme() {
  const { settings, set } = useSettings();
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
  );

  useEffect(() => {
    const compute = () =>
      settings.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : settings.theme;
    setResolvedTheme(compute());
    if (settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = () => setResolvedTheme(compute());
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    }
  }, [settings.theme]);

  return {
    theme: settings.theme,
    setTheme: (t: Theme) => {
      void set("theme", t);
    },
    resolvedTheme,
  };
}

/** Legacy provider — no-op now that SettingsProvider applies the theme class. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
