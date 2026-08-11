/**
 * i18n 코어 — 사전 조회 + 언어 스토어 (docs/20260811_three-features/03-i18n.md)
 *
 * 설계 결정 3개:
 *
 * 1. **라이브러리를 쓰지 않는다.** 필요한 게 좁다 — 언어 2개, 복수형 규칙 불필요,
 *    지연 로딩 불필요, 네임스페이스 불필요. `react-i18next` 는 의존성 트리와
 *    초기화 흐름을 끌고 오는데, 이 앱은 이미 SettingsContext 라는 설정 채널이
 *    있어 그 위에 얹는 게 더 짧다. 번들 분할(ShellV2 청크)에 공들인 코드베이스라
 *    무상관 의존성을 늘리는 것도 결이 안 맞는다.
 *
 * 2. **언어는 모듈 레벨 스토어에 둔다** (React 컨텍스트가 아니라). 번역 대상
 *    문자열의 상당수가 컴포넌트가 아니라 순수 모듈에 있다 — `lib/toast.ts`,
 *    `lib/updater.ts`, `features/planner/planList.ts`, `features/projects/
 *    managerModel.ts` 등. 컨텍스트에만 두면 이들은 `t()` 를 못 부른다.
 *    SettingsContext 가 이 스토어로 값을 밀어넣고(`setLangSetting`), React 는
 *    `useSyncExternalStore` 로 구독한다.
 *
 * 3. **사전은 점 표기 flat 키.** 중첩 객체 + 경로 타입은 타입 곡예가 필요한데,
 *    flat 키는 `keyof typeof ko` 만으로 완전한 타입 안전을 얻는다. grep 도 쉽다
 *    (`"nav.today"` 로 사전과 사용처가 함께 잡힌다).
 */
import { useMemo, useSyncExternalStore } from "react";

import { ko } from "./ko";
import { en } from "./en";

/** 실제 렌더에 쓰이는 해석된 언어. */
export type Lang = "ko" | "en";
/** 사용자가 설정에서 고르는 값 — "system" 은 OS 로케일을 따른다. */
export type LangSetting = "system" | Lang;

/** 사전 키 — `ko` 가 정본이고 `en` 은 같은 키를 전부 가져야 한다 (en.ts 참고). */
export type I18nKey = keyof typeof ko;

const DICTS: Record<Lang, Record<I18nKey, string>> = { ko, en };

// ── 언어 스토어 ───────────────────────────────────────────────────────────

/**
 * OS 로케일 → 언어. 한국어 계열만 ko, 나머지는 en.
 *
 * `navigator.language` 는 jsdom/비브라우저에서 없을 수 있어 방어한다.
 */
function systemLang(): Lang {
  const nav = typeof navigator !== "undefined" ? navigator.language : undefined;
  return nav?.toLowerCase().startsWith("ko") ? "ko" : "en";
}

/**
 * 설정값 → 실제 언어. DB 가 깨져 알 수 없는 값이 와도 "system" 취급하고
 * 절대 throw 하지 않는다 (언어 해석 실패가 앱을 못 띄우면 안 된다).
 */
export function resolveLang(setting: LangSetting | string | null | undefined): Lang {
  if (setting === "ko" || setting === "en") return setting;
  return systemLang();
}

/**
 * 임의 문자열 → 유효한 설정값. DB 에 알 수 없는 값("fr" 등)이 들어 있어도
 * UI 라디오가 "아무것도 선택 안 됨" 으로 보이지 않도록 "system" 으로 접는다.
 */
export function normalizeLangSetting(
  setting: LangSetting | string | null | undefined,
): LangSetting {
  return setting === "ko" || setting === "en" || setting === "system" ? setting : "system";
}

let currentSetting: LangSetting = "system";
let currentLang: Lang = resolveLang(currentSetting);

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** 현재 해석된 언어. 컴포넌트 밖(순수 모듈)에서 쓴다. */
export function getLang(): Lang {
  return currentLang;
}

/** 현재 설정값 (해석 전 — "system" 을 그대로 돌려준다). */
export function getLangSetting(): LangSetting {
  return currentSetting;
}

/**
 * 언어 설정 반영. SettingsContext 가 설정 로드/변경 때 호출한다.
 * 해석 결과가 같으면 구독자를 깨우지 않는다 (system→ko 처럼 표시가 안 바뀌는 변경).
 */
export function setLangSetting(setting: LangSetting | string | null | undefined): void {
  const next = resolveLang(setting);
  const nextSetting = normalizeLangSetting(setting);
  const changed = next !== currentLang || nextSetting !== currentSetting;
  currentSetting = nextSetting;
  currentLang = next;
  if (changed) notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * "system" 일 때 OS 테마 변경을 따라가듯 OS 로케일 변경도 따라가야 하지만,
 * 브라우저는 로케일 변경 이벤트를 주지 않는다 (`languagechange` 는 지원이
 * 들쭉날쭉하다). 있으면 쓰고 없으면 다음 실행에 반영된다 — 재시작 없이 바꾸고
 * 싶은 사용자는 설정에서 명시적으로 ko/en 을 고르면 된다.
 */
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("languagechange", () => {
    if (currentSetting === "system") setLangSetting("system");
  });
}

// ── 조회 ─────────────────────────────────────────────────────────────────

export type TVars = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const v = vars[name];
    // 치환값이 없으면 자리표시자를 그대로 남긴다 — 조용히 빈 문자열이 되면
    // "N건" 이 "건" 으로 렌더되고도 아무도 모른다.
    return v === undefined ? whole : String(v);
  });
}

/**
 * 번역 조회. 컴포넌트 밖에서도 호출 가능하다 (모듈 레벨 스토어를 읽으므로).
 *
 * 리렌더가 필요한 컴포넌트 안에서는 `useT()` 를 써야 한다 — `t()` 를 직접
 * 부르면 언어를 바꿔도 그 컴포넌트는 다시 그려지지 않는다.
 */
export function t(key: I18nKey, vars?: TVars): string {
  const dict = DICTS[currentLang];
  // en 은 타입상 모든 키를 갖지만, 런타임에 사전이 깨졌을 때를 대비해 ko →
  // 키 문자열 순으로 폴백한다. 빈 문자열이나 undefined 를 렌더하지 않는다.
  const raw = dict[key] ?? ko[key] ?? key;
  return interpolate(raw, vars);
}

/**
 * **모든** 언어의 값을 돌려준다 (중복 제거).
 *
 * 용도는 하나 — 검색 색인. ⌘K 팔레트는 현재 UI 언어와 무관하게 양 언어로
 * 찾혀야 한다. 한국어 사용자가 영어 모드를 켰다고 "일지" 로 못 찾으면
 * 손버릇이 끊긴다. 반대도 마찬가지다.
 *
 * 표시에는 쓰지 않는다 — 표시는 `t()`.
 */
export function tAll(key: I18nKey): string[] {
  const seen = new Set<string>();
  for (const lang of Object.keys(DICTS) as Lang[]) {
    const v = DICTS[lang][key];
    if (v) seen.add(v);
  }
  return [...seen];
}

/**
 * React 훅 — 언어가 바뀌면 구독 컴포넌트를 리렌더한다.
 *
 * `t` 의 아이덴티티는 **언어가 바뀔 때만** 바뀐다 (렌더마다가 아니라). 그래서
 * `t` 를 deps 에 넣은 useMemo/useCallback 이 언어 전환 때 정확히 한 번
 * 무효화되고, 평소에는 안정적으로 캐시된다 — 렌더마다 새 함수를 돌려주면
 * ⌘K 팔레트의 아이템 useMemo 같은 게 매 렌더 재계산된다.
 */
export function useT(): { t: typeof t; lang: Lang } {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return useMemo(
    () => ({ t: (key: I18nKey, vars?: TVars) => t(key, vars), lang }),
    [lang],
  );
}

/** 테스트 전용 — 스토어를 기본값으로 되돌린다. */
export function __resetLangForTests(): void {
  currentSetting = "system";
  currentLang = resolveLang(currentSetting);
  notify();
}

export { ko, en };
