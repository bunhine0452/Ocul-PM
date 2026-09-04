import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { commands, events } from "@/lib/bindings";
import { call } from "@/api/invoke";
import { announceFailure } from "@/lib/reportFailure";
import { applyUiScale } from "@/features/settings/uiScale";
import { createUnlistenBag } from "@/lib/unlisten";
import { resolveLang, setContentLangSetting, setLangSetting } from "@/i18n";
import {
  DEFAULTS,
  Settings,
  entriesToSettings,
  keyForField,
  serialize,
} from "@/lib/settings";
import { applyThemeAttrs, resolveThemeAttrs } from "@/features/theme/apply";
import { BUILTIN_THEMES } from "@/features/theme/builtins";
import { initThemeStore, useThemeState } from "@/features/theme/store";

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
//
// Phase 4 부터 이 표는 **내장 테마 파일에서 유도**한다 — 프리셋이 JSON 이 되어
// `family` 를 스스로 말하므로, 손으로 적은 사본을 하나 더 두면 갈라진다.
// (모바일 셸 `mobile/theme.ts` 가 이 표를 그대로 쓴다.)
export const PRESET_FAMILY: Record<string, "light" | "dark"> = Object.fromEntries(
  BUILTIN_THEMES.map((t) => [t.metadata.id, t.family === "dark" ? "dark" : "light"]),
);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  // 테마 런타임 (Osaurus 라운드 Phase 4) — 사용자 테마 목록 · 프로젝트 바인딩 ·
  // 편집 중 초안 · 시스템 강조색. 설정과 축이 다르므로 별도 스토어다.
  const themeState = useThemeState();

  useEffect(() => initThemeStore(), []);

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
    // 구독이 붙기 전에 프로바이더가 사라질 수 있다 (창을 스쳐 지나가거나 dev
    // StrictMode). 자루가 그때 도착한 리스너를 그 자리에서 뗀다 — 남으면 설정을
    // 바꿀 때마다 죽은 프로바이더의 `settingsGetAll` 이 한 벌씩 더 나간다.
    const bag = createUnlistenBag();
    bag.add(events.settingsChanged.listen(() => void reload()));
    return () => bag.dispose();
  }, [reload]);

  // 낙관적으로 먼저 그리고 쓴다. 다만 **봉투를 연다** — 예전에는 `await` 만
  // 하고 `status` 를 보지 않아, 쓰기가 거절돼도 화면은 새 값을 그린 채였다
  // (v2.42.0 `{#settings-set-unhandled}`).
  //
  // 던지지 않고 **여기서 말한다.** 이 함수를 부르는 곳은 설정 탭 밖에도 있고
  // (테마 갤러리·온보딩·`lib/theme`), 전부 `void set(...)` 로 버린다. 계약을
  // 거절로 바꾸면 그 자리들이 unhandled rejection 이 되어, 삼키던 실패를
  // **콘솔 소음으로 옮기기만** 한다. 반환값으로 분기하는 호출자는 하나도
  // 없으므로, 이 실패가 쓰일 수 있는 자리는 사용자에게 말하는 것뿐이다.
  //
  // 값을 되돌리지는 않는다: 타자 도중 입력이 제자리로 튀는 편이 더 나쁘고,
  // 다음 `reload()`(다른 창의 변경·재마운트)가 디스크의 진실을 다시 가져온다.
  const set = useCallback(
    async <K extends keyof Settings>(field: K, value: Settings[K]) => {
      setSettings((prev) => ({ ...prev, [field]: value }));
      try {
        await call("settings_set", commands.settingsSet(keyForField(field), serialize(field, value)));
      } catch (e) {
        announceFailure("settings.saveFailed", e);
      }
    },
    []
  );

  const resetAll = useCallback(async () => {
    setSettings(DEFAULTS);
    const entries = (Object.keys(DEFAULTS) as Array<keyof Settings>).map(
      (field) => [keyForField(field), serialize(field, DEFAULTS[field])] as [string, string]
    );
    try {
      await call("settings_set_many", commands.settingsSetMany(entries));
    } catch (e) {
      announceFailure("settings.saveFailed", e);
    }
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
  //
  // 완성도 라운드 Phase 3: `main.tsx` 의 `bootI18n` 이 DB 설정을 **먼저** 읽어
  // 적용하고 그 사전을 기다린 뒤 그린다. 그래서 여기서는 로드 전 기본값
  // ("system") 을 밀어 넣지 않는다 — 넣으면 부팅이 고른 언어를 OS 로케일로
  // 덮었다가 로드 뒤 되돌리는 깜빡임이 생긴다.
  useEffect(() => {
    if (!loaded) return;
    setLangSetting(settings.language);
    // Keep <html lang> honest for screen readers + `:lang()` CSS.
    const resolved = resolveLang(settings.language);
    document.documentElement.lang = resolved;
    // 앱 메뉴(⌘W 등)의 라벨은 Rust 가 그린다 — 사전도 OS 로케일도 백엔드에서
    // 읽을 수 없으므로, **해석을 끝낸 이쪽이** 결과만 넘긴다.
    void commands.applyMenuLanguage(resolved);
  }, [loaded, settings.language]);

  // --- AI 작성 언어: 같은 이유로 모듈 스토어에 밀어넣는다. 화면 언어와 **다른
  // 축**이라 별도 설정이고, "system" 이면 UI 언어를 따른다 (OS 로케일이 아니라
  // — 산출물 언어의 자연스러운 기본값은 "지금 이 사람이 읽고 있는 언어"다).
  useEffect(() => {
    setContentLangSetting(settings.contentLanguage);
  }, [settings.contentLanguage]);

  // --- Theme application (Osaurus 라운드 Phase 4 — 파일 테마까지 한 문으로).
  //
  // Decision A (2026-05-31): SettingsContext 가 테마의 단일 소유자다. 이제
  // 그 소유가 세 갈래를 함께 심판한다 — 전역 설정 · **프로젝트 바인딩**(창마다
  // 다른 프로젝트를 열 수 있다) · **편집 중 초안**(앱 자체가 미리보기다).
  // 무엇을 달지는 `resolveThemeAttrs` 가 순수하게 계산하고, 여기서는 그 결과를
  // `<html>` 에 얹기만 한다.
  //
  // `data-accent` 도 같은 계산에 들어 있다: 프리셋·커스텀 테마가 강조를
  // 소유하면 제거하고, 강조 토큰을 하나도 지정하지 않은 테마면 **유지**한다
  // (배경만 바꾼 테마를 골랐다는 이유로 강조색 선택이 사라지면 안 된다).
  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const apply = () => {
      applyThemeAttrs(
        root,
        resolveThemeAttrs({
          themeSetting: themeState.override ?? settings.theme,
          colorTheme: settings.colorTheme,
          customThemes: themeState.customThemes,
          systemAccent: themeState.systemAccent,
          prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
          draft: themeState.draft,
        }),
      );
    };
    apply();
    // "system" 만 OS 를 따라간다 — 고정 테마·프리셋·커스텀은 따라가지 않는다.
    const effective = themeState.override ?? settings.theme;
    if (effective !== "system" || themeState.draft) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [
    loaded,
    settings.theme,
    settings.colorTheme,
    themeState.override,
    themeState.customThemes,
    themeState.systemAccent,
    themeState.draft,
  ]);

  // App-wide UI scale: native webview zoom (like browser ⌘+/−). Unlike CSS
  // `zoom`, this reflows the page natively, so pixel-measuring components
  // (xterm terminal, React Flow graph, charts) stay correct instead of breaking.
  // Webview zoom resets on reload, so we re-apply on mount + whenever it changes.
  // Clamped so a bad value can't lock the user out. No-op outside Tauri.
  //
  // 클램프와 Tauri 밖 no-op 은 `features/settings/uiScale.ts` 가 소유한다 —
  // 드래그 중인 슬라이더가 **같은 적용**을 미리보기로 직접 부르기 때문이다
  // (v2.42.0 `{#settings-slider}`).
  useEffect(() => {
    if (!loaded) return;
    applyUiScale(settings.uiScale);
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

/** 프로바이더 밖(단위 테스트·시작 화면 일부)에서도 죽지 않는 읽기 — 없으면 `null`. */
export function useOptionalSettings(): SettingsContextValue | null {
  return useContext(SettingsContext);
}
