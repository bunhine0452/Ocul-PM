/**
 * 연속으로 오는 값의 **미리보기와 커밋을 가른다** (v2.42.0 `{#settings-slider}`).
 *
 * ## 무엇이 문제였나 (측정: docs/20260904_v242-load-bearing/perf-baseline.md §3)
 *
 * `<input type="range">` 는 드래그하는 동안 프레임마다 `change` 를 쏜다. 그
 * 한 프레임이 그대로 `set("uiScale", …)` 이었고, 짧은 드래그 한 번(20프레임)이
 *
 *   SQLite 쓰기 20 · `setZoom` 20 · `useSettings()` 소비자 재렌더 20
 *
 * 이 됐다. 여기에 **창 수만큼 더 붙는다**: 백엔드가 쓰기마다 `SettingsChanged`
 * 를 모든 창에 쏘고, 각 창의 프로바이더가 설정 테이블 **전체 조회**로 답한다.
 * 창이 셋이면 20프레임 = 쓰기 20 + 전체조회 60 + 프로바이더 재렌더 60.
 *
 * ## 어떻게 가르나
 *
 * 드래그 중에는 **로컬 초안**이 화면을 끌고 가고(라벨·눈금·미리보기가 즉시
 * 따라온다), 원한다면 `preview` 로 진짜 효과만 즉시 건다(배율 슬라이더의
 * 요점이 그것이다 — 숫자가 아니라 화면이 커지는 걸 보는 것). 디스크로 가는
 * 커밋은 **손을 뗀 뒤 한 번**이다. 그러면 브로드캐스트 폭풍도 함께 사라진다
 * (백엔드를 고치지 않고).
 *
 * ## 미커밋 값을 잃지 않는다
 *
 * 드래그 도중 창을 닫거나 설정 탭을 옮기면 이 훅이 언마운트된다. 그때
 * 마지막 값을 **flush** 한다 — 안 그러면 사용자가 맞춰 놓은 값이 조용히
 * 사라지고, 다음에 설정을 열면 이전 값이 앉아 있다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** 손이 멈춘 뒤 이만큼 지나면 커밋한다. 사람이 슬라이더를 놓는 시간보다 짧다. */
export const DEFERRED_COMMIT_MS = 220;

export interface DeferredCommit<T> {
  /** 화면이 그려야 하는 값 — 초안이 있으면 초안, 없으면 커밋된 값. */
  value: T;
  /** 연속 입력 한 프레임. 초안을 갱신하고 커밋은 미룬다. */
  change: (next: T) => void;
  /** 미룬 커밋을 지금 쓴다 (포인터를 놓았을 때·언마운트). */
  flush: () => void;
  /** 한 번에 정해지는 값 (프리셋 버튼) — 미리보기와 커밋을 함께 한다. */
  commit: (next: T) => void;
}

export function useDeferredCommit<T>(
  committed: T,
  write: (value: T) => void,
  opts: { delayMs?: number; preview?: (value: T) => void } = {},
): DeferredCommit<T> {
  // 초안은 `null`(없음)과 `undefined` 값을 구별해야 해서 상자에 담는다.
  const [draft, setDraft] = useState<{ v: T } | null>(null);
  const pending = useRef<{ v: T } | null>(null);
  const timer = useRef<number | null>(null);

  // 매 렌더 새로 오는 것들(인라인 화살표 함수·옵션 객체)을 의존성에 넣으면
  // `change` 가 렌더마다 새 함수가 되어 디바운스가 끊긴다. 최신 것만 들고 있는다.
  const latest = useRef({ write, opts });
  latest.current = { write, opts };

  const flush = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const held = pending.current;
    pending.current = null;
    if (!held) return;
    // 커밋은 낙관적이다 (`SettingsContext.set` 이 상태를 먼저 바꾼다) — 그래서
    // 같은 배치에서 초안을 비워도 값이 깜빡이지 않는다.
    latest.current.write(held.v);
    setDraft(null);
  }, []);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  // 언마운트 = 창을 닫았거나 탭을 옮겼다. 미커밋 값을 들고 사라지지 않는다.
  useEffect(() => () => flushRef.current(), []);

  const change = useCallback((next: T) => {
    pending.current = { v: next };
    setDraft({ v: next });
    latest.current.opts.preview?.(next);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      flushRef.current();
    }, latest.current.opts.delayMs ?? DEFERRED_COMMIT_MS);
  }, []);

  const commit = useCallback(
    (next: T) => {
      change(next);
      flushRef.current();
    },
    [change],
  );

  return { value: draft ? draft.v : committed, change, flush, commit };
}
