import type { Terminal } from "@xterm/xterm";
import { isMac } from "@/lib/platform";

// Windows·Linux 의 xterm 키 정책 (크로스플랫폼 라운드 2026-09-23 {#ui-shortcuts} {#ui-ime}).
//
// macOS 에서는 이 파일이 붙지 않는다 — 거기서 xterm 의 키 처리기는 한글 입력
// 브리지(imeBridge.ts)의 것이고, 그 경로는 한 글자도 바뀌지 않는다 (D3).
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// xterm 은 PTY 로 보낸 키의 전파를 막는다(`cancel` → stopPropagation). 그래서
// 앱 단축키가 터미널 안에서 들리려면 **xterm 이 그 키를 보내지 않게** 먼저
// 비켜 줘야 한다. 어떤 키를 비켜 주는지가 곧 "셸 키 양보" 정책이다:
//
//   Ctrl+글자 · Ctrl+[ \ ]       → 셸 (C0 제어 문자 — ^C 인터럽트, ^D EOF, ^W …)
//   Ctrl+Shift+글자              → 앱 (xterm 도 원래 안 보낸다 — 명시할 뿐)
//   Ctrl+Alt+Shift+글자          → 앱 (Linux 의 xterm 은 ESC+^X 로 보낸다 — 막는다)
//   Ctrl+숫자                     → 앱 (화면 이동 ⌘1~⌘0. xterm 은 ^3~^8 을 ESC·FS… 로 보낸다)
//   Ctrl+↑ / Ctrl+↓              → 앱 (명령 블록 이동 ⌘↑↓ — VS Code 터미널과 같은 키)
//   Ctrl+Shift+Enter             → 앱 (페인 확대 ⇧⌘↩ — xterm 은 수식어와 무관하게 CR 을 보낸다)
//   Ctrl+Tab / Ctrl+Shift+Tab    → 앱 (탭 순환 — xterm 은 TAB 을 보낸다)
//   Ctrl+Shift+C                 → 복사 (선택 영역). 셸의 ^C 와 겹치지 않는다
//   Ctrl+Shift+V                 → 붙여넣기
//   그 밖                        → xterm 기본 (Ctrl+_ undo, Shift+Insert 붙여넣기 등)

export type TerminalKeyPolicy = "pty" | "app" | "copy" | "paste";

type KeyInit = Pick<
  KeyboardEvent,
  "type" | "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"
> & { getModifierState?: (key: string) => boolean };

function altGraph(e: KeyInit): boolean {
  try {
    return e.getModifierState?.("AltGraph") === true;
  } catch {
    return false;
  }
}

/** 순수 판정 — 세 OS 표 테스트가 부른다. macOS 는 언제나 `"pty"` (이 경로를 타지 않는다). */
export function terminalKeyPolicy(e: KeyInit): TerminalKeyPolicy {
  if (isMac() || e.type !== "keydown") return "pty";
  if (!e.ctrlKey || e.metaKey || altGraph(e)) return "pty";
  const code = e.code ?? "";
  const letter = /^Key[A-Z]$/.test(code);
  if (e.shiftKey && !e.altKey && code === "KeyC") return "copy";
  if (e.shiftKey && !e.altKey && code === "KeyV") return "paste";
  if (e.shiftKey && letter) return "app";
  if (e.shiftKey && (code === "BracketLeft" || code === "BracketRight" || code === "Backslash")) {
    return "app";
  }
  if (e.altKey) return "pty";
  if (!e.shiftKey && /^Digit[0-9]$/.test(code)) return "app";
  if (!e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) return "app";
  if (e.shiftKey && e.key === "Enter") return "app";
  if (e.key === "Tab") return "app";
  return "pty";
}

/**
 * 선택 영역 복사. `execCommand("copy")` 는 포커스된 xterm 에 `copy` 이벤트를 쏘고,
 * xterm 이 그 이벤트에 선택 텍스트를 싣는다 — 키 입력(사용자 동작) 안이라 권한
 * 프롬프트 없이 두 엔진(Chromium·WebKitGTK) 모두 허용한다. 실패하면 비동기
 * 클립보드로 한 번 더.
 */
function copySelection(term: Terminal): void {
  if (!term.hasSelection()) return;
  let done = false;
  try {
    done = document.execCommand("copy");
  } catch {
    done = false;
  }
  if (done) return;
  void navigator.clipboard?.writeText?.(term.getSelection()).catch(() => {});
}

/**
 * 붙여넣기. Chromium(WebView2)은 textarea 의 Ctrl+Shift+V 를 기본 동작("서식 없이
 * 붙여넣기")으로 처리해 `paste` 이벤트를 쏘고, xterm 이 그걸 bracketed paste 로
 * 보낸다 — 우리는 xterm 이 ^V 를 보내지 않게 비켜 주기만 하면 된다. WebKitGTK 는
 * 그 키에 기본 동작이 없어 `paste` 가 오지 않는다 — 같은 태스크 안에 안 왔으면
 * 비동기 클립보드에서 읽어 `term.paste` 로 넣는다 (두 번 들어가지 않게 하나만).
 */
function pasteClipboard(term: Terminal): void {
  const target = term.element;
  if (!target) return;
  let pasted = false;
  const mark = () => {
    pasted = true;
  };
  target.addEventListener("paste", mark, { capture: true, once: true });
  setTimeout(() => {
    target.removeEventListener("paste", mark, { capture: true });
    if (pasted) return;
    const read = navigator.clipboard?.readText?.bind(navigator.clipboard);
    if (!read) return;
    void read()
      .then((text) => {
        if (text) term.paste(text);
      })
      .catch(() => {});
  }, 0);
}

export interface TerminalKeysHandle {
  dispose(): void;
}

/** Windows·Linux 전용 — xterm 의 키 처리기를 단다. macOS 에서는 부르지 않는다. */
export function attachTerminalKeys(term: Terminal): TerminalKeysHandle {
  term.attachCustomKeyEventHandler((event) => {
    switch (terminalKeyPolicy(event)) {
      case "copy":
        event.preventDefault();
        copySelection(term);
        return false;
      case "paste":
        // preventDefault 하지 않는다 — Chromium 의 기본 붙여넣기가 이 키에 달려 있다.
        pasteClipboard(term);
        return false;
      case "app":
        // Tab 의 기본 동작은 포커스 이동이다 — xterm 이 삼키던 것을 비켜 주면서
        // 포커스까지 터미널 밖으로 새면 안 된다. 탭 순환은 창(TabbedWindow)이 받는다.
        if (event.key === "Tab") event.preventDefault();
        return false;
      default:
        return true;
    }
  });
  return {
    dispose() {
      term.attachCustomKeyEventHandler(() => true);
    },
  };
}

/**
 * 한글 입력 브리지를 붙일 OS 인가 — **macOS(WKWebView)만**.
 *
 * 브리지는 WKWebView 의 실측 트레이스에서 나온 우회다: 조합 이벤트 없이 input 이
 * keydown 보다 먼저 오는 옛 모델, 영문 모드에서도 IME 를 거쳐 한 번 더 올라오는
 * ASCII, NBSP 공백, 화살표에서 조합을 확정하는 macOS 입력기. Chromium(WebView2)은
 * 표준 조합 모델(compositionstart/update/end + insertCompositionText)을 쏘고,
 * xterm 의 CompositionHelper 는 바로 그 모델을 위해 만들어져 VS Code 터미널이
 * Windows 에서 매일 쓰는 경로다. WebKitGTK 도 GTK 입력기의 preedit 을 표준 조합
 * 이벤트로 옮긴다. 검증된 적 없는 우회를 얹기보다 xterm 기본 경로를 쓴다.
 */
export function usesImeBridge(): boolean {
  return isMac();
}
