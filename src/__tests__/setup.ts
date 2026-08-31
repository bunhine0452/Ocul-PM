// ⚠ 첫 import — Node 26+ 에서 가려지는 localStorage/sessionStorage 를 되살린다.
// (이유는 storageShim.ts 주석. 다른 import 보다 먼저 실행돼야 한다.)
import "./storageShim";

import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { vi } from "vitest";

// `findBy*` · `waitFor` 의 대기 예산 — 기본 1000ms 는 **CI 러너에서 모자란다.**
//
// 2026-08-31: `acp_parallel_sessions` 의 "A 가 도는 중에 연 새 대화" 가 CI 에서만
// 1183ms 에 죽었다(로컬 5회 연속 통과). 실패 모양은 `sent` 가 빈 배열 — 클릭은
// 됐는데 그 뒤 커맨드가 예산 안에 도착하지 못한 것이다. 이런 실패는 **아무것도
// 알려 주지 않는다**: 코드가 틀린 게 아니라 러너가 느렸다는 뜻이라, 붉은 CI 를
// 보고도 무시하게 만들어 진짜 회귀를 가린다.
//
// 성공 경로는 조건이 만족되는 즉시 빠져나오므로 이 값은 **통과 시간에 영향이
// 없다**. 늘어나는 것은 진짜로 실패할 때의 대기뿐이다. 로컬과 CI 에 같은 값을
// 주는 이유도 같다 — 환경마다 다르면 "로컬에선 되는데" 를 다시 만든다.
configure({ asyncUtilTimeout: 5000 });

import { registerDict, setLangSetting } from "@/i18n";
import { ko } from "@/i18n/ko";
import { en } from "@/i18n/en";

// i18n Phase 0/2 — UI 언어를 한국어로 **고정**한다.
//
// 언어 기본값은 "system" 이라 `navigator.language` 를 따르는데, 그러면 같은
// 스위트가 한국 개발 머신에서는 통과하고 CI(en-US jsdom)에서는 깨진다.
// 한국어로 고정하는 이유는 기존 스위트 대부분이 한글 UI 문자열로 요소를 찾기
// 때문이다(`getByText("작업 일지")`).
//
// **`navigator.language` 부터 고정한다.** `setLangSetting("ko")` 만으로는
// 부족했다 — `SettingsProvider` 를 마운트하는 테스트는 provider 의 effect 가
// 저장된 설정(기본값 "system")을 스토어로 밀어넣으면서 그 고정을 덮어쓰고,
// "system" 은 jsdom 의 en-US 로 풀린다. 문자열이 하드코딩 한글이던 동안에는
// 드러나지 않다가 화면을 `t()` 로 옮기는 순간 그 테스트들이 깨졌다.
// 로케일 자체를 고정하면 "system" 경로까지 결정적이 된다.
Object.defineProperty(navigator, "language", { value: "ko-KR", configurable: true });
Object.defineProperty(navigator, "languages", { value: ["ko-KR", "ko"], configurable: true });
// 사전은 앱에서 동적 import 다 (Phase 3) — 테스트는 둘 다 미리 얹어 `t()` 가
// 동기적으로 답하게 한다 (`i18n_english_render` 가 en 을 즉시 쓴다).
registerDict("ko", ko);
registerDict("en", en);
setLangSetting("ko");

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Lite-W6 PR6.4: components that render `<WorkspaceProvider>` register
// `events.oculpm*.listen(...)` handlers on mount. Outside the Tauri runtime
// (jsdom) those calls dereference an undefined `__TAURI_INTERNALS__` and
// throw, which floods the test output without failing assertions. Stub
// `@tauri-apps/api/event` with no-op subscribers so the listeners install
// quietly. Tests that need to fire payloads can override per-test.
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
  once: () => Promise.resolve(() => {}),
  emit: () => Promise.resolve(),
  TauriEvent: {},
}));
