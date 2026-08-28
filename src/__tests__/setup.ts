// ⚠ 첫 import — Node 26+ 에서 가려지는 localStorage/sessionStorage 를 되살린다.
// (이유는 storageShim.ts 주석. 다른 import 보다 먼저 실행돼야 한다.)
import "./storageShim";

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

import { setLangSetting } from "@/i18n";

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
