/**
 * 터미널 이미지 미리보기의 상태 — 창 하나에 하나, 모듈 범위(`termStore` 와 같은 꼴).
 *
 * 링크(`fileLinks.ts`)가 사건을 넣고, 화면(`TermImagePeek.tsx`)이 그린다. 올리면 **카드**,
 * 누르면 **그 파일을 Finder 에서**(11-04 「클릭 시 경로로 이동」), ⌘ 를 누른 채 누르면 **고정**(크게).
 * 고정된 동안에는 다른 링크를 스쳐도 바꾸지 않는다.
 */
import { useSyncExternalStore } from "react";

import { toAppError } from "@/api/invoke";
import { terminalApi } from "@/api/terminal";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toast } from "@/lib/toast";

import type { ImageLinkEvent } from "./fileLinks";

/** 지나가는 마우스에 그림이 번쩍이지 않게 — 이만큼 머물러야 띄운다. */
export const HOVER_DELAY_MS = 120;

export interface Peek {
  path: string;
  x: number;
  y: number;
  pinned: boolean;
  /**
   * 마우스를 쓰는 전체 화면 프로그램 위에서 올렸다(`fileLinks` 의 올림 사건) — 맨 클릭은 그 프로그램의 것이고 수식키
   * 누름이 Finder 라, 카드의 안내가 그 뜻을 말한다.
   */
  tracking: boolean;
}

/**
 * 벗어난 뒤 이만큼은 카드를 그대로 둔다 (11-28). xterm 은 링크가 있는 줄이 다시 그려질 때마다 「벗어남」 을 보내고
 * 곧바로 「올림」 을 다시 보낸다(`Linkifier` 의 `onRenderedViewportChange`). Claude 가 일하는 동안에는 화면이 계속
 * 다시 그려져, 마우스를 올려 둔 내내 카드가 내려갔다 다시 뜨며 그림을 매번 새로 풀었다 — 그것이 버벅임이었다.
 * 같은 경로에 이 안에 다시 올라오면 카드는 그 자리에 그대로다.
 */
export const LEAVE_GRACE_MS = 150;

let current: Peek | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let leaving: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();

function set(next: Peek | null) {
  current = next;
  for (const fn of subs) fn();
}

function clearTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function clearLeaving() {
  if (leaving !== null) clearTimeout(leaving);
  leaving = null;
}

export function peekEvent(event: ImageLinkEvent): void {
  clearTimer();
  if (event.kind === "leave") {
    if (!current || current.pinned || leaving !== null) return;
    leaving = setTimeout(() => {
      leaving = null;
      if (current && !current.pinned) set(null);
    }, LEAVE_GRACE_MS);
    return;
  }
  const { path, x, y } = event;
  if (event.kind === "reveal") {
    clearLeaving();
    if (current && !current.pinned) set(null);
    terminalApi
      .imageReveal(path)
      .catch((e: unknown) => toast.warning(t("terminal.peek.revealFailed", { error: tError(toAppError(e)) })));
    return;
  }
  if (event.kind === "open") {
    clearLeaving();
    return set({ path, x, y, pinned: true, tracking: false });
  }
  if (current?.pinned) return;
  // 떠 있는 카드와 같은 그림에 다시 올라왔다 — 내리려던 것을 거두고 그대로 둔다(다시 그리지도 않는다).
  if (current?.path === path) return clearLeaving();
  const tracking = event.tracking === true;
  timer = setTimeout(() => {
    timer = null;
    clearLeaving();
    if (!current?.pinned) set({ path, x, y, pinned: false, tracking });
  }, HOVER_DELAY_MS);
}

export function closePeek(): void {
  clearTimer();
  clearLeaving();
  set(null);
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useImagePeek(): Peek | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
