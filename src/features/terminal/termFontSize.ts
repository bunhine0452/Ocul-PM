/**
 * 터미널 글자 크기 키 (2026-11-03) — ⌘= / ⌘+ 크게, ⌘- 작게, ⌘0 기본. Windows·Linux 는 Ctrl.
 * 다른 터미널(iTerm · Terminal.app · VS Code)과 같은 키다. 값은 설정(SQLite)에 남아 모든 창이 같다.
 */
import { isMac } from "@/lib/platform";

export const TERM_FONT_DEFAULT = 13;
export const TERM_FONT_MIN = 9;
export const TERM_FONT_MAX = 28;

/** 저장된 값을 범위 안 정수로 — 옛 값 · 손으로 고친 값이 칸을 깨지 않게. */
export function clampTermFont(n: number): number {
  if (!Number.isFinite(n)) return TERM_FONT_DEFAULT;
  return Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, Math.round(n)));
}

/** 이 키가 글자 크기 키면 새 크기, 아니면 `null`. 자판 배열과 무관하게 `code` 로 읽는다. */
export function termFontKey(
  e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey">,
  current: number,
): number | null {
  const mod = isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return null;
  if (e.code === "Equal" || e.code === "NumpadAdd") return clampTermFont(current + 1);
  if (e.code === "Minus" || e.code === "NumpadSubtract") return clampTermFont(current - 1);
  if (e.code === "Digit0" || e.code === "Numpad0") return TERM_FONT_DEFAULT;
  return null;
}
