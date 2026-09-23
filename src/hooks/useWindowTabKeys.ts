import { useEffect } from "react";
import { isTerminalSurface, readChord } from "@/lib/kbd";
import { isMac } from "@/lib/platform";

/**
 * ⌘T / ⌘W 의 Windows·Linux 판 — **키다운으로 받는다** (크로스플랫폼 라운드
 * 2026-09-23 {#ui-shortcuts}).
 *
 * macOS 에서는 앱 메뉴가 소유한다(`src-tauri/src/menu.rs` 의 액셀러레이터 →
 * `NewTabIntent`·`CloseIntent`). 이 훅은 macOS 에서 아무것도 하지 않는다.
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
 */
export function useWindowTabKeys({
  onNewTab,
  onClose,
}: {
  onNewTab: () => void;
  onClose: () => void;
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNewTab, onClose]);
}
