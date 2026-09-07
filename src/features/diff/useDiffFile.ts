/**
 * 변경 diff 화면의 **고른 파일 한 장** — 선택 · 본문 조회 · +N/−M 요약.
 *
 * `DiffScreenV2` 에서 그대로 들어냈다 (분할 라운드, 플랜 `v3-release`
 * {#planner-diff-split}). 목록은 `useDiffChanges` 가, 검색은 `useDiffSearch`
 * 가 갖는다 — 이 훅은 "지금 보고 있는 파일" 하나만 책임진다.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { useWorkspace } from "@/contexts/WorkspaceContext";
import { tError } from "@/i18n/errors";
import { commands, type DiffResult } from "@/lib/bindings";
import { recentChangesStore, type RecentChange } from "@/lib/recentChangesStore";
import type { DiffBaseline } from "./changeList";
import { countPatchStats } from "./diffParse";

const DIFF_MAX_BYTES = 64 * 1024;

export interface DiffFile {
  selected: string | null;
  select: (path: string) => void;
  /** 목록에서 고른 파일의 변경 종류 (없으면 null). */
  current: RecentChange | null;
  diff: DiffResult | null;
  /** 기준선이 없는 파일(미추적/신규)의 전문을 +줄로 합성한 패치. */
  newFilePatch: string | null;
  /** 파일 본문 읽기 실패 사유 — 없으면 "읽는 중…" 에 영원히 갇힌다. */
  newFileError: string | null;
  loading: boolean;
  error: string | null;
  /** 본문 조회의 「다시 시도」 — 같은 파일을 다시 부르려면 흔들 것이 필요하다. */
  retry: () => void;
  /** 현재 파일의 +N/−M (셀 수 없으면 null). */
  stats: { add: number; del: number } | null;
}

export function useDiffFile(
  projectId: number,
  changes: RecentChange[],
  baseline: DiffBaseline,
): DiffFile {
  const { state, setState } = useWorkspace();
  const { diffActivePath } = state;

  // Selected file. Seed from diffActivePath (the journal-card → diff handoff
  // parked by PR-UI 3), else the most recent change.
  const [selected, setSelected] = useState<string | null>(diffActivePath);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [newFilePatch, setNewFilePatch] = useState<string | null>(null);
  const [newFileError, setNewFileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffNonce, setDiffNonce] = useState(0);
  const consumedHandoff = useRef(false);
  // Latest merged change list for use inside the fetch effect (which only
  // depends on projectId/selected) — lets us know a file's op (e.g. "D" =
  // deleted) without re-running the fetch on every watcher push.
  const changesRef = useRef(changes);
  changesRef.current = changes;

  // Consume the one-shot diffActivePath handoff once, then clear it so a
  // later manual pick doesn't snap back. Mirrors LocalDiffView's diffTarget.
  useEffect(() => {
    if (consumedHandoff.current) return;
    consumedHandoff.current = true;
    if (diffActivePath) {
      setSelected(diffActivePath);
      setState((prev) => ({ ...prev, diffActivePath: null }));
    }
  }, [diffActivePath, setState]);

  // Default selection → most recent change; keep the pick if still present.
  useEffect(() => {
    if (changes.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((prev) => {
      if (prev && changes.some((c) => c.path === prev)) return prev;
      return changes[changes.length - 1].path;
    });
  }, [changes]);

  // Fetch diff for the selected file (cancel-safe).
  useEffect(() => {
    if (!selected) {
      setDiff(null);
      setNewFilePatch(null);
      setNewFileError(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNewFilePatch(null);
    setNewFileError(null);
    commands
      .computeDiff(projectId, selected, DIFF_MAX_BYTES, baseline === "last_commit" ? "last_commit" : null)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status !== "ok") {
          setDiff(null);
          setError(tError(res.error));
          return;
        }
        setDiff(res.data);
        // No git/snapshot baseline (untracked or never-indexed file). Read the
        // file and show its whole content as additions, so the change is
        // visible right away instead of the "no baseline" prompt. A *deleted*
        // file has no disk content to read (and no baseline) — skip the read so
        // we don't trip "Failed to read … No such file"; DiffBody renders a
        // deleted-file notice instead.
        if (res.data.source.source === "snapshots_unavailable") {
          const op = changesRef.current.find((c) => c.path === selected)?.op;
          if (op === "D") {
            setNewFilePatch(null);
          } else {
            const fileRes = await commands.readProjectFile(projectId, selected);
            if (cancelled) return;
            if (fileRes.status === "ok") {
              setNewFilePatch(
                fileRes.data.split("\n").map((l) => "+" + l).join("\n"),
              );
            } else {
              // 읽기 실패를 상태로 남겨 "읽는 중…" 무한 대기 대신 안내를 띄운다.
              setNewFileError(tError(fileRes.error));
            }
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDiff(null);
          setError(String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selected, baseline, diffNonce]);

  // Mark the change read once its body renders (mirrors LocalDiffView).
  useEffect(() => {
    if (!selected || loading || error || !diff) return;
    recentChangesStore.markRead(projectId, selected);
  }, [projectId, selected, diff, loading, error]);

  // 현재 파일의 +N/−M 요약 — 패치 텍스트에서 직접 센다 (바이너리는 패치가
  // 없으므로 자연히 숨는다). 헤더 제외는 countPatchStats 가 위치 기반으로
  // 처리한다 — startsWith("---") 식 접두 검사는 `---` 내용 줄 삭제(`----`)를
  // 헤더로 오인해 빠뜨린다.
  const stats = useMemo(() => {
    const src = diff?.source;
    if (src?.source === "git" || src?.source === "snapshot") {
      const { add, del } = countPatchStats(src.patch);
      return add === 0 && del === 0 ? null : { add, del };
    }
    // 신규 파일의 합성 패치: 헤더 없이 전 줄이 +내용 이므로 줄 수가 곧 +N.
    if (newFilePatch) return { add: newFilePatch.split("\n").length, del: 0 };
    return null;
  }, [diff, newFilePatch]);

  return {
    selected,
    select: setSelected,
    current: changes.find((c) => c.path === selected) ?? null,
    diff,
    newFilePatch,
    newFileError,
    loading,
    error,
    retry: () => setDiffNonce((n) => n + 1),
    stats,
  };
}
