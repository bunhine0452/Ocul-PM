import { useCallback, useSyncExternalStore } from "react";

import { verificationLine } from "./commandBlocks";

/**
 * 끝난 명령의 **결과 끝 줄** — 페인(sid)마다 마지막 하나 (UI 밀도 라운드 3, 시안 Terminal).
 *
 * 도크가 한 줄로 접히면 xterm 은 내려가지만 「마지막 명령의 결과만 한 줄」은 남아야 한다 —
 * 그래서 xterm 밖 모듈 저장소다. `TerminalInstanceImpl` 이 OSC 133;D 에서 쓰고,
 * 접힌 도크·결과 줄·검증 칸 복사가 읽는다. 세션 메모리에만 산다 (디스크 X).
 */
export interface LastResult {
  sid: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  /** 출력의 마지막 비공백 줄 — 테스트 러너는 거기에 `N passed` 를 둔다. 없으면 빈 문자열. */
  lastLine: string;
  at: number;
}

const bySid = new Map<string, LastResult>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const fn of listeners) fn();
}

export const lastResultStore = {
  set(result: LastResult): void {
    bySid.set(result.sid, result);
    emit();
  },
  get(sid: string | null | undefined): LastResult | null {
    return sid ? (bySid.get(sid) ?? null) : null;
  },
  /** 여러 페인 중 가장 최근에 끝난 것. */
  latest(sids: readonly string[]): LastResult | null {
    let best: LastResult | null = null;
    for (const sid of sids) {
      const r = bySid.get(sid);
      if (r && (!best || r.at > best.at)) best = r;
    }
    return best;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  _reset(): void {
    bySid.clear();
    emit();
  },
};

/** 검증 칸 한 줄 — `명령 · 결과 끝 줄 · exit N`. */
export function lastResultLine(r: LastResult): string {
  return verificationLine(r.command, r.lastLine, r.exitCode);
}

/** 이 sid 들 중 가장 최근 결과를 구독한다. */
export function useLatestResult(sids: readonly string[]): LastResult | null {
  const key = sids.join("\n");
  const snapshot = useCallback(() => {
    void version;
    return lastResultStore.latest(key ? key.split("\n") : []);
  }, [key]);
  return useSyncExternalStore(lastResultStore.subscribe, snapshot, snapshot);
}
