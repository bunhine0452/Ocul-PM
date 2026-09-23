/**
 * 수정키 — 매칭과 표기의 단일 창구 (크로스플랫폼 라운드 2026-09-23
 * {#ui-shortcuts} {#ui-labels}).
 *
 * **macOS 에서 이 모듈은 아무것도 바꾸지 않는다** (D3). 매칭은 예전 식
 * (`metaKey || ctrlKey`) 그대로고, 표기는 받은 문자열을 그대로 돌려준다. 모든
 * 분기는 `isMac()` 에서 먼저 갈라진다.
 *
 * Windows·Linux 규칙:
 *
 *   - ⌘ 자리는 Ctrl 이다. ⌃ 도 Ctrl, ⌥ 는 Alt, ⇧ 는 Shift. 표기는 그 OS 의
 *     관례 순서(Ctrl+Alt+Shift+키)로 다시 세운다 — 맥 표기 "⇧⌘D" 는 "Ctrl+Shift+D".
 *   - AltGr 은 Windows 에서 Ctrl+Alt 로 온다. 독일어 자판의 AltGr+ß(`\`)가 ⌘\ 로
 *     읽히면 역슬래시를 칠 때마다 AI 화면으로 튄다 — AltGr 은 수정키가 아니다.
 *   - **터미널 안에서 Ctrl+글자는 셸의 것이다.** Ctrl+C(인터럽트)·D(EOF)·
 *     K·L·R·U·W·Z… 는 전부 C0 제어 문자라 가로채면 셸이 망가진다. 그래서 터미널
 *     안에서 앱 단축키는 **Shift 를 하나 더 얹는다** (gnome-terminal·Windows
 *     Terminal 의 관례): ⌘D → Ctrl+Shift+D. 맥에서 이미 ⇧ 가 붙은 것(⇧⌘D)은
 *     Alt 까지 얹는다: Ctrl+Alt+Shift+D.
 */
import { isMac } from "./platform";

// ── 매칭 ──────────────────────────────────────────────────────────────────

/** 키보드·마우스 이벤트 모두 받는다 (트리 다중 선택이 마우스 클릭이다). */
export interface ModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  getModifierState?: (key: "AltGraph") => boolean;
  target?: EventTarget | null;
}

function isAltGraph(e: ModifierState): boolean {
  try {
    return e.getModifierState?.("AltGraph") === true;
  } catch {
    return false;
  }
}

/** Windows·Linux 의 ⌘ 자리 — Ctrl, 단 AltGr(= Ctrl+Alt 로 오는 제3 글쇠)은 아니다. */
function ctrlHeld(e: ModifierState): boolean {
  return e.ctrlKey && !isAltGraph(e);
}

/** 포커스가 xterm(내장 터미널) 안인가 — xterm 의 숨은 textarea 가 키를 받는다. */
export function isTerminalTarget(target: EventTarget | null | undefined): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    target.closest(".xterm") !== null
  );
}

/** 포커스가 터미널 면(`.term-wrap` — 머리띠·레일·페인 포함) 또는 xterm 안인가. */
export function isTerminalSurface(target: EventTarget | null | undefined): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    target.closest(".xterm, .term-wrap") !== null
  );
}

/**
 * 화면 단축키의 ⌘(mac) / Ctrl(그 외) 가 눌렸나.
 *
 * mac 은 **예전 식 그대로** ⌃ 도 받는다 — 여러 핸들러가 `metaKey || ctrlKey` 로
 * 써 왔고, 그 동작을 바꾸지 않는다 (D3).
 *
 * Windows·Linux 에서 포커스가 **xterm 안이면 거짓**이다 — 거기서 Ctrl+글자는
 * 셸의 것이라(Ctrl+S 는 XOFF, Ctrl+F 는 한 글자 앞으로) 뒤에 떠 있는 화면(일지·
 * 편집기)이 가로채면 안 된다. 터미널 안에서도 동작해야 하는 전역·터미널 면
 * 단축키는 이 함수가 아니라 `readChord` 로 읽는다.
 */
export function isModKey(e: ModifierState): boolean {
  if (isMac()) return e.metaKey || e.ctrlKey;
  return ctrlHeld(e) && !isTerminalTarget(e.target);
}

/** ⌘ 만 — 예전 코드가 `metaKey` 하나만 보던 자리(⌘⌥←→). 그 외 OS 는 Ctrl (xterm 밖). */
export function isCmdKey(e: ModifierState): boolean {
  if (isMac()) return e.metaKey;
  return ctrlHeld(e) && !isTerminalTarget(e.target);
}

/** 이벤트의 키 이름 — 비라틴 자판(한글 두벌식 등)에서는 `code` 로 라틴 글자를 되찾는다. */
function keyOf(e: Pick<KeyboardEvent, "key" | "code">): string {
  const key = e.key ?? "";
  if (/^[\x21-\x7e]$/.test(key)) return key;
  const code = e.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return key;
}

/** Shift 를 뗀 괄호 — ⇧ 를 얹으면 `key` 가 `{` `|` `}` 로 바뀐다. */
const SHIFTED_BRACKETS: Record<string, string> = {
  BracketLeft: "[",
  Backslash: "\\",
  BracketRight: "]",
};

/** Ctrl+이 키 가 셸의 제어 문자인가 — 글자 전부와 `[` `\` `]` (ESC·FS·GS). */
export function isShellKey(key: string): boolean {
  return /^[a-zA-Z[\\\]]$/.test(key);
}

type ChordEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target"
> &
  ModifierState;

/**
 * Windows·Linux 에서 **터미널(xterm) 안의 Ctrl+셸 키**인가 — 셸에 양보한다.
 *
 * 앱 전역 단축키가 먼저 확인한다. xterm 도 이 키를 PTY 로 보내면서 전파를 막지만,
 * 그건 xterm 내부 사정이다 — 양보 규칙은 여기 한 줄로 적혀 있어야 표로 시험할 수
 * 있다. macOS 는 언제나 false (⌘ 와 ⌃ 가 다른 키라 겹칠 일이 없다).
 */
export function yieldsToShell(e: ChordEvent): boolean {
  if (isMac()) return false;
  if (!isTerminalTarget(e.target)) return false;
  if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return false;
  return isShellKey(keyOf(e));
}

/** 앱 단축키로 읽은 키 조합. `mod` 는 ⌘(mac)/Ctrl(그 외). */
export interface Chord {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** 원래 `key` — 셸 키를 터미널 가족으로 읽을 때만 소문자 라틴 글자로 정규화된다. */
  key: string;
}

/**
 * 이벤트를 앱 단축키로 읽는다.
 *
 * `family`:
 *   - `"app"` — 보통 화면. 단, 포커스가 xterm 안이면 터미널 가족으로 읽는다.
 *   - `"terminal"` — 터미널 면(분할·검색·지우기…)의 키. 포커스와 무관하게 늘
 *     터미널 가족이다 — 표기가 하나로 고정돼야 상태 막대의 안내가 거짓말을 안 한다.
 *
 * 터미널 가족 (Windows·Linux, 셸 키만):
 *   Ctrl+X             → 셸의 것 (mod=false)
 *   Ctrl+Shift+X       → ⌘X
 *   Ctrl+Alt+Shift+X   → ⇧⌘X
 *
 * macOS: `{ mod: metaKey || ctrlKey, shift, alt, key }` — 예전 핸들러와 같은 식.
 */
export function readChord(e: ChordEvent, family: "app" | "terminal" = "app"): Chord {
  if (isMac()) {
    return { mod: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey, key: e.key };
  }
  const plain: Chord = { mod: false, shift: e.shiftKey, alt: e.altKey, key: e.key };
  if (!ctrlHeld(e)) return plain;
  const bracket = e.shiftKey ? SHIFTED_BRACKETS[e.code] : undefined;
  const key = bracket ?? keyOf(e);
  const terminal = family === "terminal" || isTerminalTarget(e.target);
  if (terminal && isShellKey(key)) {
    if (!e.shiftKey) return plain;
    return { mod: true, shift: e.altKey, alt: false, key: key.toLowerCase() };
  }
  return { mod: true, shift: e.shiftKey, alt: e.altKey, key };
}

// ── 표기 ──────────────────────────────────────────────────────────────────

const MOD_GLYPHS = /[⌃⌥⇧⌘]+/;
/** 수정키 묶음 + 뒤따르는 키 하나 (이름 있는 키는 통째로). */
const CHORD = /([⌃⌥⇧⌘]+)(Tab|Enter|Esc|Space|Backspace|Delete|F1[0-2]|F[1-9]|[↩⏎⌫⌦]|[^\s⌃⌥⇧⌘])?/gu;
const KEY_NAMES: Record<string, string> = { "↩": "Enter", "⏎": "Enter", "⌫": "Backspace", "⌦": "Delete" };

/**
 * 맥 표기의 수정키 조합을 이 OS 의 표기로 — 문장 안의 조합도 전부.
 *
 *   mac      "⇧⌘D 아래 분할"  → 그대로
 *   그 외    "⇧⌘D 아래 분할"  → "Ctrl+Shift+D 아래 분할"
 *   터미널   "⌘D 분할"        → "Ctrl+Shift+D 분할"   (셸 키에 Shift 를 얹는다)
 *
 * 원문(맥 표기)이 정본이다. 사전(`ko.ts`·`en.ts`)과 단축키 표는 맥 표기로 적고,
 * `t()` 와 치트시트가 그릴 때 이 함수를 지난다.
 */
export function kbd(text: string, context: "app" | "terminal" = "app"): string {
  if (isMac() || !MOD_GLYPHS.test(text)) return text;
  return text.replace(CHORD, (_whole, mods: string, rawKey: string | undefined) => {
    let ctrl = mods.includes("⌘") || mods.includes("⌃");
    let alt = mods.includes("⌥");
    let shift = mods.includes("⇧");
    const key = rawKey ? (KEY_NAMES[rawKey] ?? rawKey) : "";
    if (context === "terminal" && mods.includes("⌘") && isShellKey(key)) {
      if (shift) alt = true;
      shift = true;
      ctrl = true;
    }
    const parts: string[] = [];
    if (ctrl) parts.push("Ctrl");
    if (alt) parts.push("Alt");
    if (shift) parts.push("Shift");
    const shown = /^[a-z]$/.test(key) ? key.toUpperCase() : key;
    return parts.join("+") + "+" + shown;
  });
}

/** `modLabel("K")` → mac `⌘K` / 그 외 `Ctrl+K`. */
export function modLabel(key: string, context: "app" | "terminal" = "app"): string {
  return kbd(`⌘${key}`, context);
}
