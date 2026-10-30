/**
 * 터미널 이미지 미리보기의 상태 — 창 하나에 하나, 모듈 범위(`termStore` 와 같은 꼴).
 *
 * 링크(`fileLinks.ts`)가 사건을 넣고, 화면(`TermImagePeek.tsx`)이 그린다. 올리면 **카드**,
 * 누르면 **고정**(크게). 고정된 동안에는 다른 링크를 스쳐도 바꾸지 않는다.
 */
import { useSyncExternalStore } from "react";

import type { ImageLinkEvent } from "./fileLinks";

/** 지나가는 마우스에 그림이 번쩍이지 않게 — 이만큼 머물러야 띄운다. */
export const HOVER_DELAY_MS = 120;

export interface Peek {
  path: string;
  x: number;
  y: number;
  pinned: boolean;
}

let current: Peek | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();

function set(next: Peek | null) {
  current = next;
  for (const fn of subs) fn();
}

function clearTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

export function peekEvent(event: ImageLinkEvent): void {
  clearTimer();
  if (event.kind === "leave") {
    if (current && !current.pinned) set(null);
    return;
  }
  const { path, x, y } = event;
  if (event.kind === "open") return set({ path, x, y, pinned: true });
  if (current?.pinned) return;
  timer = setTimeout(() => {
    timer = null;
    if (!current?.pinned) set({ path, x, y, pinned: false });
  }, HOVER_DELAY_MS);
}

export function closePeek(): void {
  clearTimer();
  set(null);
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useImagePeek(): Peek | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
