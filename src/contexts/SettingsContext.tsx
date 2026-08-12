import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { commands, events } from "@/lib/bindings";
import { safeUnlisten } from "@/lib/unlisten";
import { resolveLang, setContentLangSetting, setLangSetting } from "@/i18n";
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

  // 다른 창(또는 상단바)에서 설정을 바꾸면 여기서도 다시 읽는다.
  //
  // 창이 여럿이고(크롬식 탭) 트레이 팝오버는 앱 시작 때 한 번 만들어져 세션
  // 내내 살아 있다 — 마운트 1회 조회만으로는 한쪽에서 테마·언어를 바꿔도
  // 나머지가 예전 값을 계속 그린다. 백엔드가 쓰기 직후 쏘는 이벤트로 맞춘다.
  useEffect(() => {
    let off: (() => void) | undefined;
    void events.settingsChanged.listen(() => void reload()).then((fn) => {
      off = fn;
    });
    return () => {
      if (off) safeUnlisten(off);
    };
  }, [reload]);

  const set = useCallback(
    async <K extends keyof Settings>(field: K, value: Settings[K]) => {
      setSettings((prev) => ({ ...prev, [field]: value }));
      await commands.settingsSet(keyForField(field), serialize(field, value));
    },
    []
  );

  const resetAll = useCallback(async () => {
    setSettings(DEFAULTS);
    const entries = (Object.keys(DEFAULTS) as Array<keyof Settings>).map(
      (field) => [keyForField(field), serialize(field, DEFAULTS[field])] as [string, string]
    );
    await commands.settingsSetMany(entries);
  }, []);

  // --- UI language: push the persisted setting into the i18n module store.
  // The store (not this context) is the source `t()` reads, because a large
  // share of translatable strings live in plain modules — lib/toast.ts,
  // lib/updater.ts, features/planner/planList.ts — which can't consume a React
  // context. `useT()` subscribes to that store, so components still re-render.
  //
  // Runs before `loaded` too: DEFAULTS.language is "system", so the very first
  // paint already resolves to the OS locale instead of flashing Korean at an
  // English user and then swapping.
  useEffect(() => {
    setLangSetting(settings.language);
    // Keep <html lang> honest for screen readers + `:lang()` CSS.
    const resolved = resolveLang(settings.language);
    document.documentElement.lang = resolved;
    // 앱 메뉴(⌘W 등)의 라벨은 Rust 가 그린다 — 사전도 OS 로케일도 백엔드에서
    // 읽을 수 없으므로, **해석을 끝낸 이쪽이** 결과만 넘긴다.
    void commands.applyMenuLanguage(resolved);
  }, [settings.language]);

  // --- AI 작성 언어: 같은 이유로 모듈 스토어에 밀어넣는다. 화면 언어와 **다른
  // 축**이라 별도 설정이고, "system" 이면 UI 언어를 따른다 (OS 로케일이 아니라
  // — 산출물 언어의 자연스러운 기본값은 "지금 이 사람이 읽고 있는 언어"다).
  useEffect(() => {
    setContentLangSetting(settings.contentLanguage);
  }, [settings.contentLanguage]);

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
    () => ({ settings, loaded, set, reload, resetAll }),
    [settings, loaded, set, reload, resetAll]
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
