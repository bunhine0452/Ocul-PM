import { useEffect } from "react";
import { windowApi } from "@/api/window";
import { t } from "@/i18n";
import { isNewWindowChord, isTerminalSurface, readChord } from "@/lib/kbd";
import { isMac } from "@/lib/platform";
import { toast } from "@/lib/toast";

/** 새 창을 연다 — 실패는 토스트로. 모듈 함수라 정체가 고정된다. */
export function openNewWindow(): void {
  windowApi.newWindow().catch((e: unknown) => {
    toast.destructive(t("project.newWindowFailed", { error: e instanceof Error ? e.message : String(e) }));
  });
}

/**
 * ⌘T / ⌘W / ⇧⌘N 의 Windows·Linux 판 — **키다운으로 받는다** (크로스플랫폼 라운드
 * 2026-09-23 {#ui-shortcuts} · {#os-new-window}).
 *
 * macOS 에서는 앱 메뉴가 소유한다(`src-tauri/src/menu.rs` 의 액셀러레이터 →
 * `NewTabIntent`·`CloseIntent`·새 창). 이 훅은 macOS 에서 아무것도 하지 않는다.
 *
 * Windows·Linux 에서 메뉴 액셀러레이터에 기대지 않는 이유:
 *   - WebView2 는 키 입력을 브라우저 프로세스의 창이 받아, 호스트의 메시지
 *     루프(Tauri 가 `TranslateAcceleratorW` 를 거는 곳)를 지나지 않는다 —
 *     웹뷰에 포커스가 있는 동안 메뉴 액셀러레이터가 안 들을 수 있다.
 *   - 들린다면 더 나쁘다: 터미널에서 Ctrl+W(셸의 단어 지우기)가 페인을 닫는다.
 *     포커스가 터미널 안인지는 프런트만 안다.
 *
 * 그래서 여기서 받고, 터미널 면 안에서는 터미널 가족(Ctrl+Shift+T / Ctrl+Shift+W)
 * 으로 읽는다 (`lib/kbd.ts`). 어느 쪽이든 결과는 메뉴와 같은 "안쪽부터" 사슬이다.
 *
 * 새 창(Ctrl+Shift+N, `isNewWindowChord`)은 **캡처 단계**에서 먼저 받고 이벤트를
 * 멈춘다 — 맥에서 메뉴가 웹뷰보다 먼저 ⇧⌘N 을 먹는 것과 같은 자리다. 버블 단계에
 * 두면 Shift 를 보지 않는 화면 단축키(일지의 ⌘N 새 일지 · 검색의 ⌘N 지우기 · 시작
 * 화면의 ⌘N 새 프로젝트)가 같은 키를 먼저 먹는다.
 */
export function useWindowTabKeys({
  onNewTab,
  onClose,
  onNewWindow = openNewWindow,
}: {
  onNewTab: () => void;
  onClose: () => void;
  onNewWindow?: () => void;
}): void {
  useEffect(() => {
    if (isMac()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const c = readChord(e, isTerminalSurface(e.target) ? "terminal" : "app");
      if (!c.mod || c.shift || c.alt) return;
      const k = c.key.toLowerCase();
      if (k === "t") {
        e.preventDefault();
        onNewTab();
      } else if (k === "w") {
        e.preventDefault();
        onClose();
      }
    };
    const onNewWindowKey = (e: KeyboardEvent) => {
      if (!isNewWindowChord(e)) return;
      e.preventDefault();
      e.stopPropagation();
      // 누르고 있으면 자동 반복이 창을 줄줄이 연다 — 첫 번만.
      if (!e.repeat) onNewWindow();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onNewWindowKey, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onNewWindowKey, true);
    };
  }, [onNewTab, onClose, onNewWindow]);
}
