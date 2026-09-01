/**
 * 테마 런타임 상태 — 창 하나가 공유하는 모듈 스토어 (Phase 4).
 *
 * React 컨텍스트가 아니라 모듈 스토어인 이유는 i18n 언어 스토어와 같다:
 * 값을 **미는 쪽**(탭 창 · 편집기)과 **읽는 쪽**(SettingsContext 의 적용
 * 이펙트)이 컨텍스트 트리에서 서로 조상이 아니다.
 *
 * `localStorage` 를 쓰지 않는다 — 테마 상태를 거기 두고 싶어지는 자리지만
 * `WorkspaceContext` 만 그 키를 소유한다 (`lint:storage`). 지속되는 값은
 * 설정(SQLite)과 테마 파일(앱 데이터)이고, 여기 있는 것은 **런타임**뿐이다.
 */
import { themesApi } from "@/api/themes";
import { createStore } from "@/lib/createStore";
import type { ThemeFile } from "@/lib/bindings";

export interface ThemeState {
  /** 사용자가 만든 테마 (`theme_list`). */
  customThemes: readonly ThemeFile[];
  /**
   * 이 창의 프로젝트 바인딩. `null` = 바인딩 없음 → 전역 설정 테마.
   * 창마다 다른 프로젝트를 열 수 있으므로 **창 단위**다 (설계 §5).
   */
  override: string | null;
  /** 편집 중인 초안 — 있으면 앱 전체가 이 테마로 그려진다 (라이브 프리뷰). */
  draft: ThemeFile | null;
  /** macOS 시스템 강조색 hex. 읽지 못했으면 `null`. */
  systemAccent: string | null;
  /** 목록을 한 번이라도 읽었나 — 갤러리가 "없음" 과 "아직" 을 구분한다. */
  loaded: boolean;
}

const EMPTY: ThemeState = {
  customThemes: [],
  override: null,
  draft: null,
  systemAccent: null,
  loaded: false,
};

const store = createStore<ThemeState>(EMPTY);

export const useThemeState = store.useValue;
export const getThemeState = store.get;
export const subscribeThemeState = store.subscribe;

/** 프로젝트 바인딩을 민다 (활성 탭이 바뀔 때마다). */
export function setThemeOverride(value: string | null): void {
  store.update((prev) => (prev.override === value ? prev : { ...prev, override: value }));
}

/** 편집 초안을 민다 — `null` 이면 프리뷰를 끝내고 저장된 상태로 돌아간다. */
export function setThemeDraft(draft: ThemeFile | null): void {
  store.update((prev) => (prev.draft === draft ? prev : { ...prev, draft }));
}

/** 목록을 다시 읽는다. 실패해도 화면은 살아 있어야 하므로 조용히 넘어간다. */
export async function refreshThemes(): Promise<void> {
  try {
    const list = await themesApi.list();
    // 배열이 아니면 목록을 못 읽은 것과 같이 다룬다 — 갤러리가 비는 것과
    // 앱이 죽는 것은 다르다 (테스트 하네스의 스텁이 실제로 `null` 을 준다).
    store.update((prev) => ({
      ...prev,
      customThemes: Array.isArray(list) ? list : [],
      loaded: true,
    }));
  } catch {
    store.update((prev) => ({ ...prev, loaded: true }));
  }
}

/** 시스템 강조색을 다시 읽는다 (창 포커스마다 — OS 설정은 앱 밖에서 바뀐다). */
export async function refreshSystemAccent(): Promise<void> {
  try {
    const systemAccent = await themesApi.systemAccent();
    store.update((prev) =>
      prev.systemAccent === systemAccent ? prev : { ...prev, systemAccent },
    );
  } catch {
    /* 다른 OS · 읽기 실패 — 테마가 자기 강조색으로 산다 */
  }
}

/**
 * 창 하나당 한 번. 목록·시스템 강조색을 읽고, 다른 창의 변경을 구독한다.
 * 해제 함수를 돌려준다 (`SettingsProvider` 언마운트 시).
 */
export function initThemeStore(): () => void {
  void refreshThemes();
  void refreshSystemAccent();
  const offChanged = themesApi.onChanged(() => void refreshThemes());
  const onFocus = () => void refreshSystemAccent();
  window.addEventListener("focus", onFocus);
  return () => {
    offChanged();
    window.removeEventListener("focus", onFocus);
  };
}

/** 테스트 전용 — 스토어를 처음 상태로. */
export function resetThemeStore(): void {
  store.set(EMPTY);
}
