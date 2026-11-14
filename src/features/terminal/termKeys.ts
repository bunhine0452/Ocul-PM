/**
 * 터미널 키 층 (2026-11-15, 업그레이드 라운드 TI-01 · TI-02 · TI-03 · TI-08).
 *
 * xterm 5.5 가 손버릇과 다르게 보내는 키를 바로잡는다. 순수 함수 하나라 표로 시험한다
 * (`term_keys.test.ts`). 브리지(`imeBridge`)가 조합 판정 다음, 맨 앞에서 부르고 — 값이 있으면 그 키를
 * xterm 에서 걷어 내고 대신 실행한다.
 *
 * ── 무엇을 ────────────────────────────────────────────────────────────────────
 *  Shift+Enter   xterm 은 Enter 에 Alt 만 본다(Keyboard.ts case 13) — Shift+Enter 도 CR 이라 반쯤 쓴
 *                프롬프트가 제출됐다. 에이전트가 대체 화면에 있으면(Ocul 은 NO_FLICKER 라 Claude · Codex TUI 는
 *                대체 화면, 에이전트인지는 상태 신호로 — `agentScreen.ts`) ESC CR — ⌥Enter 와 같은 바이트, Claude
 *                Code 의 줄바꿈이다. 그 밖은 그대로 CR — bash readline 에서 ESC CR 은 vi 모드 전환이고, vim 입력
 *                모드에서는 ESC 로 노멀 모드에 빠진다(대체 화면만 보던 11-15 첫 판이 그랬다).
 *  맥 줄 편집     ⌘⌫ ⌃U · ⌘← ⌃A · ⌘→ ⌃E · ⌥← ESC b · ⌥→ ESC f (Ghostty · iTerm2 「Natural Text Editing」
 *                기본값). xterm 5.5 는 ⌘← → 에 아무것도 안 보내고 ⌘⌫ 는 한 글자만 지운다. ⌥← → 는 5.5 가
 *                흉내 내지만 xterm 6 이 그 흉내를 뺀다(#5346) — 여기서 못박는다. ⌥⌘+방향키(칸 이동)는
 *                터미널 화면의 캡처가 먼저 잡으니 건드리지 않는다.
 *  맥 ⌃ 키        ⌃/ 0x1F(되돌리기) · ⌃2 · ⌃Space 0x00 — xterm 5.5 는 ⌃/ · ⌃2 에 아무것도 안 보낸다.
 *  그 밖 OS 복사  Ctrl+Shift+V 는 붙여넣기, Ctrl+Shift+C · 고른 채 Ctrl+C 는 복사. xterm 은 이 키들을
 *                0x16 · 0x03 으로 보내 키로 복사할 길이 없었다. 고른 것 없는 Ctrl+C 는 그대로 인터럽트다.
 *                Ctrl+V 붙여넣기는 Windows 만이다(Windows Terminal · VS Code 의 Windows 판). Linux 터미널
 *                (GNOME Terminal · Konsole · VS Code 의 Linux 판)에서 Ctrl+V 는 ^V — vim 의 블록 선택 ·
 *                readline 의 quoted-insert — 라 xterm 에 그대로 둔다.
 *  ⌘L            고른 출력을 「Claude 에게 보내기」로(Cursor · VS Code 의 ⌘L). 그 밖 OS 는 터미널 가족
 *                규칙대로 Ctrl+Shift+L(`kbd.readChord`). 고른 것이 없으면 키를 그대로 둔다.
 */
import { isImeComposing } from "@/lib/ime";
import type { Platform } from "@/lib/platform";

export interface KeyCtx {
  platform: Platform;
  /** 안의 프로그램이 대체 화면(`buffer.active.type === "alternate"`)을 쓰는 중. */
  altScreen: boolean;
  /** 그 화면의 프로그램이 상태 신호(OSC 7501)를 보낸 에이전트다 — Claude Code · Codex (`agentScreen.ts`). */
  agent: boolean;
  hasSelection: boolean;
}

/**
 * `send` — 이 바이트를 PTY 로. `native` — PTY 로 보내지 않고 클립보드 동작에 맡긴다.
 * `sendSelection` — 고른 출력을 Claude 에게 보낼 대화상자를 연다.
 */
export type KeyAction =
  | { kind: "send"; seq: string }
  | { kind: "native"; op: "copy" | "paste" }
  | { kind: "sendSelection" };

export type KeyEventLike = Pick<
  KeyboardEvent,
  "type" | "key" | "code" | "keyCode" | "isComposing" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

const ESC = "\x1b";

/** 눌린 수정키가 정확히 이것뿐인가 — 하나라도 더 눌렸으면 이 층의 키가 아니다. */
function only(e: KeyEventLike, want: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }): boolean {
  return (
    e.metaKey === (want.meta ?? false) &&
    e.ctrlKey === (want.ctrl ?? false) &&
    e.altKey === (want.alt ?? false) &&
    e.shiftKey === (want.shift ?? false)
  );
}

/** 라틴 글자 하나 — 두벌식에서는 `key` 가 자모라 자리(`code`)로 되찾는다(`kbd.ts` 의 keyOf 와 같은 규칙). */
function latin(e: KeyEventLike): string {
  if (/^[\x21-\x7e]$/.test(e.key)) return e.key.toLowerCase();
  if (/^Key[A-Z]$/.test(e.code ?? "")) return e.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(e.code ?? "")) return e.code.slice(5);
  return e.key;
}

const MAC_CMD = new Map([
  ["Backspace", "\x15"],
  ["ArrowLeft", "\x01"],
  ["ArrowRight", "\x05"],
]);
const MAC_OPT = new Map([
  ["ArrowLeft", `${ESC}b`],
  ["ArrowRight", `${ESC}f`],
]);
const MAC_CTRL = new Map([
  ["/", "\x1f"],
  ["2", "\x00"],
  [" ", "\x00"],
]);

const send = (seq: string | undefined): KeyAction | null => (seq === undefined ? null : { kind: "send", seq });

/**
 * keypress 를 keydown 처럼 읽는다 — 조합 키(229) 뒤에 따로 오는 Enter 의 keypress 를 이 층에 다시 물을 때
 * (`imeBridge`). 그 모드에서는 keydown 이 229 라 이 층을 건너뛴다.
 */
export function asKeydown(e: KeyEventLike): KeyEventLike {
  return {
    type: "keydown",
    key: e.key,
    code: e.code,
    keyCode: e.keyCode,
    isComposing: e.isComposing,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
  };
}

/** keydown 하나 → 이 층이 맡을 일. 맡지 않으면 `null`(xterm 이 종전대로 처리한다). */
export function translateKey(e: KeyEventLike, ctx: KeyCtx): KeyAction | null {
  if (e.type !== "keydown" || isImeComposing(e)) return null;

  if (e.key === "Enter" && only(e, { shift: true })) {
    return ctx.altScreen && ctx.agent ? { kind: "send", seq: `${ESC}\r` } : null;
  }

  if (ctx.platform === "mac") {
    if (only(e, { meta: true })) {
      if (latin(e) === "l") return ctx.hasSelection ? { kind: "sendSelection" } : null;
      return send(MAC_CMD.get(e.key));
    }
    if (only(e, { alt: true })) return send(MAC_OPT.get(e.key));
    if (only(e, { ctrl: true })) return send(MAC_CTRL.get(latin(e)));
    return null;
  }

  const letter = latin(e);
  if (only(e, { ctrl: true, shift: true })) {
    if (letter === "v") return { kind: "native", op: "paste" };
    if (letter === "c") return { kind: "native", op: "copy" };
    if (letter === "l" && ctx.hasSelection) return { kind: "sendSelection" };
    return null;
  }
  if (only(e, { ctrl: true })) {
    if (letter === "v" && ctx.platform === "windows") return { kind: "native", op: "paste" };
    if (letter === "c" && ctx.hasSelection) return { kind: "native", op: "copy" };
  }
  return null;
}
