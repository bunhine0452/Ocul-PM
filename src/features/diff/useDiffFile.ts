/**
 * 변경 diff 화면의 **고른 파일 한 장** — 선택 · 본문 조회 · +N/−M 요약.
 *
 * `DiffScreenV2` 에서 그대로 들어냈다 (분할 라운드, 플랜 `v3-release`
 * {#planner-diff-split}). 목록은 `useDiffChanges` 가, 건너온 지정은 `useDiffHandoff`
 * 가 갖는다 — 이 훅은 "지금 보고 있는 파일" 하나만 책임진다.
 *
 * 11-15 (#diff-exact · #diff-perf):
 *  - 열어 둔 파일을 에이전트가 다시 고치면(워처가 새 시각을 주면) 250ms 뒤 조용히 다시 읽는다 — 본문을
 *    걷지 않으니 스크롤이 그대로고, 머리줄이 「11:42 에 다시 바뀜」 을 말한다. 예전엔 diff 는 그대로인데
 *    메모 판정만 새 내용을 봤다.
 *  - 파일을 넘길 때 이전 본문을 그대로 두고, 150ms 넘게 걸릴 때만 `slow` 를 세운다 — 넘길 때마다
 *    「diff 계산 중」 이 깜빡였다.
 *  - 기준본 없는 새 파일은 백엔드가 앞 64KB 만 읽어 패치로 준다 — 프런트가 파일을 통째로 읽던 길은 걷었다.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { tError } from "@/i18n/errors";
import { diffApi } from "@/api/diff";
import { toAppError } from "@/api/invoke";
import type { DiffResult } from "@/lib/bindings";
import { recentChangesStore, type RecentChange } from "@/lib/recentChangesStore";
import type { DiffBaseline } from "./changeList";
import { countPatchStats } from "./diffParse";

const DIFF_MAX_BYTES = 64 * 1024;
/** 같은 파일의 연이은 저장을 한 번으로 — 에이전트는 한 번에 여러 번 쓴다. */
export const REFRESH_DEBOUNCE_MS = 250;
/** 이보다 빨리 오는 본문은 「불러오는 중」 을 보이지 않는다. */
export const SLOW_MS = 150;

export interface DiffStats {
  add: number;
  del: number;
  /** 잘린 diff 의 숫자 — 실제로는 이보다 많다(「이상」). */
  atLeast: boolean;
}

export interface DiffFile {
  selected: string | null;
  select: (path: string) => void;
  /** 목록에서 고른 파일의 변경 종류 (없으면 null). */
  current: RecentChange | null;
  /** 보이는 본문 — 파일을 넘기는 동안에는 이전 파일의 것이다(`diff.path` 로 가린다). */
  diff: DiffResult | null;
  /** 조회 중. 본문은 그대로 두므로 화면은 `slow` 만 본다. */
  loading: boolean;
  /** 150ms 넘게 걸리는 조회. */
  slow: boolean;
  error: string | null;
  /** 본문 조회의 「다시 시도」 — 같은 파일을 다시 부르려면 흔들 것이 필요하다. */
  retry: () => void;
  /** 현재 파일의 +N/−M (셀 수 없으면 null). */
  stats: DiffStats | null;
  /** 보던 파일이 다시 바뀌어 다시 읽었다 — 그 변경의 시각(ms). 다른 파일을 고르면 null. */
  changedAt: number | null;
}

export function useDiffFile(
  projectId: number,
  changes: RecentChange[],
  baseline: DiffBaseline,
  opts: { autoSelect: boolean; ignoreWhitespace: boolean },
): DiffFile {
  const { autoSelect, ignoreWhitespace } = opts;
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffNonce, setDiffNonce] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [changedAt, setChangedAt] = useState<number | null>(null);

  // 기본 선택 → 가장 최근 변경; 고른 것이 목록에 남아 있으면 그대로. 묶음이 오기 전(최대 300ms)에는
  // 고르지 않는다 — 고른 뒤 「일지 없음 첫 파일」 로 다시 튀며 두 번 읽었다 (화면이 `autoSelect` 를 쥔다).
  useEffect(() => {
    if (changes.length === 0) {
      setSelected(null);
      return;
    }
    if (!autoSelect) return;
    setSelected((prev) => {
      if (prev && changes.some((c) => c.path === prev)) return prev;
      return changes[changes.length - 1].path;
    });
  }, [changes, autoSelect]);

  // 고른 파일이 다시 바뀌었나 — 워처가 준 시각으로 안다. 같은 파일에서 시각만 바뀌면 조용히 다시 읽는다.
  const selTs = useMemo(() => changes.find((c) => c.path === selected)?.ts ?? 0, [changes, selected]);
  const seen = useRef<{ path: string | null; ts: number }>({ path: null, ts: 0 });
  useEffect(() => {
    const prev = seen.current;
    seen.current = { path: selected, ts: selTs };
    if (prev.path !== selected) {
      setChangedAt(null);
      return;
    }
    if (!selected || selTs === 0 || selTs === prev.ts) return;
    const id = setTimeout(() => {
      setChangedAt(selTs);
      setRefresh((n) => n + 1);
    }, REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [selected, selTs]);

  // Fetch diff for the selected file (cancel-safe). 본문은 비우지 않는다 — 새 답이 오면 바꾼다.
  useEffect(() => {
    if (!selected) {
      setDiff(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => !cancelled && setSlow(true), SLOW_MS);
    diffApi
      .compute(projectId, selected, DIFF_MAX_BYTES, baseline === "last_commit" ? "last_commit" : null, ignoreWhitespace)
      .then((data) => {
        if (cancelled) return;
        setDiff(data);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setDiff(null);
        setError(tError(toAppError(e)));
      })
      .finally(() => {
        clearTimeout(timer);
        if (cancelled) return;
        setLoading(false);
        setSlow(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, selected, baseline, ignoreWhitespace, diffNonce, refresh]);

  // Mark the change read once its body renders (mirrors LocalDiffView).
  useEffect(() => {
    if (!selected || error || diff?.path !== selected) return;
    recentChangesStore.markRead(projectId, selected);
  }, [projectId, selected, diff, error]);

  // 현재 파일의 +N/−M 요약 — 패치 텍스트에서 직접 센다 (바이너리는 패치가 없으므로 자연히 숨는다).
  // 헤더 제외는 countPatchStats 가 위치 기반으로 처리한다. 잘린 diff 면 「이상」.
  const stats = useMemo<DiffStats | null>(() => {
    const src = diff?.source;
    if (src?.source !== "git" && src?.source !== "snapshot" && src?.source !== "new_file") return null;
    const { add, del } = countPatchStats(src.patch);
    return add === 0 && del === 0 ? null : { add, del, atLeast: diff?.truncated != null };
  }, [diff]);

  return {
    selected,
    select: setSelected,
    current: changes.find((c) => c.path === selected) ?? null,
    diff,
    loading,
    slow,
    error,
    retry: () => setDiffNonce((n) => n + 1),
    stats,
    changedAt,
  };
}
