/**
 * 터미널 복사 정리 (2026-11-15, 업그레이드 라운드 TI-07 — Orca #19770 · Paradev 가 각각 고친 짜증).
 *
 * Claude 출력 · 에러 로그를 이슈 · 메신저에 붙이면 에이전트가 그린 왼쪽 여백, TUI 가 줄을 채우려고
 * 찍은 줄 끝 공백, 화면 아래의 빈 줄이 딸려 왔다. 복사할 때 걷는다: 모든 줄이 함께 가진 앞 공백만
 * (상대 들여쓰기는 그대로), 줄 끝 공백, 끝의 빈 줄.
 *
 * 줄은 xterm 의 `getSelection()` 으로 받는다 — 셀에서 줄을 다시 짓지 않는다. xterm 5.5 의 선택 글은
 * 이미 셀 줄을 조립한 것이다: 이어진 줄(isWrapped)을 붙이고, 넓은 글자가 칸 끝에 안 맞아 다음 줄로
 * 넘어가며 남긴 빈칸(InputHandler.print 가 코드 0 · 폭 1 로 비우는 셀)은 `translateToString(trimRight)`
 * 가 잘라 낸다 — 시험(`term_copy.test.ts`)이 진짜 xterm 버퍼로 이것을 문다. 손으로 다시 지으면
 * Windows · Linux 의 Alt+끌기(열 선택)까지 따로 흉내 내야 한다.
 *
 * Claude 의 전체 화면은 Claude 가 직접 복사하므로, 여기가 닿는 곳은 ⌥ 로 고른 선택과 셸이다.
 */

/** 복사가 쓰는 xterm 의 몫 — 시험이 가짜로 갈아 끼운다. */
export interface CopyTerm {
  hasSelection(): boolean;
  getSelection(): string;
  clearSelection(): void;
}

const leadingSpaces = (line: string) => line.length - line.trimStart().length;

/** 고른 줄들 → 붙여 넣을 글. 빈 줄(공백뿐인 줄)은 공통 여백을 정할 때 빼고 본다. */
export function cleanSelection(lines: readonly string[]): string {
  const trimmed = lines.map((line) => line.replace(/\xa0/g, " ").trimEnd());
  const filled = trimmed.filter((line) => line.length > 0);
  const indent = filled.length > 0 ? Math.min(...filled.map(leadingSpaces)) : 0;
  const out = trimmed.map((line) => line.slice(Math.min(indent, line.length)));
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** 지금 고른 글을 정리해서 — 고른 것이 없으면 빈 글. */
export function selectedText(term: CopyTerm): string {
  if (!term.hasSelection()) return "";
  return cleanSelection(term.getSelection().split(/\r?\n/));
}

/** 클립보드에 쓸 글 — Windows 면 줄바꿈을 CRLF 로(xterm 의 선택 글과 같은 규칙, Windows 앱에 붙여 넣는 글). */
const forClipboard = (text: string, windows: boolean) => (windows ? text.replace(/\n/g, "\r\n") : text);

/**
 * host 캡처 단계의 copy — xterm 의 처리기 대신 정리한 글을 클립보드에. 고른 것이 없으면 아무것도
 * 하지 않는다(xterm 과 같은 규칙 — 마우스 보고 중이면 선택은 안의 프로그램 몫이다).
 *
 * `windows` 면 줄바꿈을 CRLF 로(`forClipboard`).
 * `clear` 면 복사 뒤 선택을 지운다 — Windows Terminal 규약(다음 Ctrl+C 가 다시 인터럽트가 되게).
 */
export function handleCopy(term: CopyTerm, event: ClipboardEvent, opts: { windows: boolean; clear: boolean }): void {
  const text = selectedText(term);
  if (!text || !event.clipboardData) return;
  event.clipboardData.setData("text/plain", forClipboard(text, opts.windows));
  event.preventDefault();
  event.stopPropagation();
  if (opts.clear) term.clearSelection();
}

/**
 * 키로 복사한다 (Windows · Linux 의 Ctrl+Shift+C · 고른 채 Ctrl+C).
 *
 * Blink(WebView2)의 편집 키 표에는 Ctrl+C · Ctrl+Insert → Copy 만 있고 Ctrl+Shift+C 가 없다 — 키를
 * 브라우저에 넘기기만 하면 복사 이벤트가 안 난다. 그래서 복사 명령을 직접 부른다: 브라우저가 copy
 * 이벤트를 쏘고 위 `handleCopy` 가 받는다(정리 규칙이 한 곳). 명령이 안 들으면 비동기 클립보드로 —
 * 줄 끝도 같은 규칙으로 맞춘다(Windows 는 CRLF).
 */
export function copySelectionNow(term: CopyTerm, opts: { clear: boolean; windows: boolean }): void {
  if (execCopy()) return;
  const text = selectedText(term);
  if (!text) return;
  void navigator.clipboard?.writeText(forClipboard(text, opts.windows)).catch(() => {});
  if (opts.clear) term.clearSelection();
}

/** 브라우저의 복사 명령 — copy 이벤트를 쏘고, 처리기가 받아 클립보드에 썼으면 `true`. */
function execCopy(): boolean {
  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  }
}
