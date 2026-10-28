import { useEffect } from "react";
import { windowApi } from "@/api/window";
import { t } from "@/i18n";
import { isNewWindowChord, readChord } from "@/lib/kbd";
import { isMac } from "@/lib/platform";
import { toast } from "@/lib/toast";

/** 새 시작 창을 연다 — 실패는 토스트로. 모듈 함수라 정체가 고정된다. */
export function openNewWindow(): void {
  windowApi.newWindow().catch((e: unknown) => {
    toast.destructive(t("project.newWindowFailed", { error: e instanceof Error ? e.message : String(e) }));
  });
}

/** 이 창을 닫는다 — Windows·Linux 의 Ctrl+W. */
export function closeThisWindow(): void {
  windowApi.closeThisWindow().catch(() => {
    /* 웹뷰 밖(테스트·브라우저 미리보기) — 닫을 창이 없다 */
  });
}

/**
 * ⌘W / ⇧⌘N 의 Windows·Linux 판 — **키다운으로 받는다** (크로스플랫폼 라운드
 * {#ui-shortcuts} · {#os-new-window}). 창 하나가 프로젝트 하나라(4.0) ⌘W 는 창을 닫는다.
 *
 * macOS 에서는 앱 메뉴가 소유한다(`src-tauri/src/menu.rs` 의 액셀러레이터 — ⌘W 창
 * 닫기 · ⇧⌘N 새 창). 이 훅은 macOS 에서 아무것도 하지 않는다 — 여기서도 받으면
 * 창이 두 번 열린다.
 *
 * 새 창(Ctrl+Shift+N, `isNewWindowChord`)은 **캡처 단계**에서 먼저 받고 이벤트를
 * 멈춘다 — 맥에서 메뉴가 웹뷰보다 먼저 ⇧⌘N 을 먹는 것과 같은 자리다. 버블 단계에
 * 두면 Shift 를 보지 않는 화면 단축키(일지의 ⌘N 새 일지)가 같은 키를 먼저 먹는다.
 */
export function useWindowKeys({
  onClose = closeThisWindow,
  onNewWindow = openNewWindow,
}: {
  onClose?: () => void;
  onNewWindow?: () => void;
} = {}): void {
  useEffect(() => {
    if (isMac()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const c = readChord(e);
      if (!c.mod || c.shift || c.alt) return;
      if (c.key.toLowerCase() !== "w") return;
      e.preventDefault();
      onClose();
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
  }, [onClose, onNewWindow]);
}
