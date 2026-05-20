import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

  // --- Theme application: write `.dark` class on <html> based on theme setting
  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const apply = () => {
      const desired =
        settings.theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
          : settings.theme === "dark";
      root.classList.toggle("dark", desired);
    };
    apply();
    if (settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [settings.theme, loaded]);

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
