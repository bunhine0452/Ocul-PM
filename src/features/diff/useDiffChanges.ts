/**
 * 변경 diff 화면의 **목록** 한 벌 — 무엇이 바뀌었는가, 무엇과 비교하는가,
 * 그 변경들이 어느 일지·계획에 묶이고 무엇에 영향을 주는가.
 *
 * `DiffScreenV2` 에서 그대로 들어냈다 (분할 라운드, 플랜 `v3-release`
 * {#planner-diff-split}). 화면 파일이 한계(800줄)에 붙어 새 빈 상태 JSX 를 한
 * 줄로 눌러 담아야 했는데, 그 부피의 대부분은 **그리는 코드가 아니라 물어보는
 * 코드**였다. 규약은 `features/sessions/useSessionBoard.ts` 와 같다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { ChangeGroup, ImpactReport } from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import { useRecentChanges, type RecentChange } from "@/lib/recentChangesStore";
import { toast } from "@/lib/toast";
import { autoBaseline, mergeChanges, toBaselineChanges, type DiffBaseline } from "./changeList";

export interface LastCommit {
  sha: string;
  short_sha: string;
  subject: string;
  changes: { path: string; op: string }[];
}

export interface DiffChanges {
  /** 지금 고른 기준선의 변경 목록. */
  changes: RecentChange[];
  workingChanges: RecentChange[];
  lastCommitChanges: RecentChange[];
  baseline: DiffBaseline;
  /** 사용자가 기준선을 고정한다 (자동 선택을 이긴다). */
  pinBaseline: (baseline: DiffBaseline) => void;
  lastCommit: LastCommit | null;
  /** 작업트리를 보는 중인데 돌아갈 커밋이 있다 — 빈 상태의 탈출구. */
  hasLastCommit: boolean;

  /** 첫 답이 오기 전 — 이 동안 "변경 없음" 이라고 단언하면 안 된다. */
  listLoading: boolean;
  listError: string | null;
  retryList: () => void;

  groups: ChangeGroup[] | null;
  impact: ImpactReport | null;
  /** 곁들이(그룹핑·영향 분석)의 실패 — 목록 자체는 멀쩡하므로 가리지 않는다. */
  enrichError: string | null;
  retryEnrich: () => void;

  toggleVerified: (relativePath: string, next: boolean) => Promise<void>;
}

export function useDiffChanges(projectId: number): DiffChanges {
  const { t } = useT();
  // v2 U3 — watcher 버퍼는 전용 스토어 구독. 이 화면만 파일 이벤트에 리렌더한다.
  const recentChanges = useRecentChanges(projectId);

  // Bug 1 fix — persistent change source. The live `recentChanges` watcher
  // buffer is wiped on project switch and never populated while the app was
  // closed, so it loses any change not observed live in the current session.
  // `git status` gives us the full uncommitted set regardless of uptime /
  // active project; we seed the file list from it and merge live edits on top.
  const [gitChanges, setGitChanges] = useState<RecentChange[]>([]);
  // 목록 조회의 첫 프레임 게이트 + 실패 (2026-09-04). 없던 동안 `git status`·직전
  // 커밋 조회가 실패해도, 답이 오기 **전**에도 화면은 "이 브랜치엔 아직 변경이
  // 없어요" 라고 단언했다 — 정상 상태와 글자 하나 다르지 않게. 이 화면은 제품
  // 약속 「믿지 말고 보라」의 본체라 거짓 빈 화면이 특히 비싸다.
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listNonce, setListNonce] = useState(0);
  // The 변경 diff screen is uncommitted-only by nature: once work is committed
  // `git status` goes clean and the screen would read "변경 없음" even though the
  // change is real (the journal still shows it via its sidecar). So we also fetch
  // the most recent commit and fall back to it when the working tree is clean.
  const [lastCommit, setLastCommit] = useState<LastCommit | null>(null);
  // Auto-pick the baseline; the user can pin a choice.
  const [baselinePinned, setBaselinePinned] = useState<DiffBaseline | null>(null);

  // 프로젝트 전환 시 화면-로컬 상태 리셋. 사이드바 인라인 전환은 이 화면을
  // 리마운트하지 않으므로, 이전 프로젝트의 baseline pin·직전 커밋 정보가 새
  // 프로젝트 위에 그대로 남는 누수를 막는다.
  useEffect(() => {
    setBaselinePinned(null);
    setGitChanges([]);
    setLastCommit(null);
  }, [projectId]);

  const watcherPathKey = recentChanges.map((c) => c.path).join("\n");
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    commands
      .gitUncommittedChanges(projectId)
      .then((res) => {
        if (cancelled) return;
        setGitChanges(res.status === "ok" ? toBaselineChanges(res.data) : []);
        setListError(res.status === "ok" ? null : tError(res.error));
      })
      .catch((e) => {
        if (cancelled) return;
        setGitChanges([]);
        setListError(String(e));
      })
      .finally(() => !cancelled && setListLoading(false));
    return () => {
      cancelled = true;
    };
    // Re-seed on project switch and whenever the watcher reports a new edit (a
    // commit / stage / new file changes `git status`); non-git projects yield
    // an empty list and the watcher buffer carries the screen on its own.
  }, [projectId, watcherPathKey, listNonce]);

  useEffect(() => {
    let cancelled = false;
    commands
      .gitLastCommitChanges(projectId)
      .then((res) => {
        if (cancelled) return;
        setLastCommit(res.status === "ok" ? res.data : null);
        // git status 가 이미 말한 실패를 덮지 않는다 — 먼저 온 사유가 더 가깝다.
        if (res.status !== "ok") setListError((prev) => prev ?? tError(res.error));
      })
      .catch((e) => {
        if (cancelled) return;
        setLastCommit(null);
        setListError((prev) => prev ?? String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, watcherPathKey, listNonce]);

  // Working-tree changes: persistent git baseline + live edits.
  const workingChanges = useMemo(
    () => mergeChanges(gitChanges, recentChanges),
    [gitChanges, recentChanges],
  );
  const lastCommitChanges = useMemo<RecentChange[]>(
    () => toBaselineChanges(lastCommit?.changes ?? []),
    [lastCommit],
  );

  const baseline =
    baselinePinned ?? autoBaseline(workingChanges.length, lastCommitChanges.length);
  const changes = baseline === "last_commit" ? lastCommitChanges : workingChanges;
  const hasLastCommit = baseline === "working" && lastCommitChanges.length > 0;

  // Dogfooding #3 — group the changed files by the journal entry (and linked
  // plan items) that recorded them. `null` until loaded / on error → the file
  // list falls back to the flat view.
  const [groups, setGroups] = useState<ChangeGroup[] | null>(null);
  // 곁들이(그룹핑·영향 분석) 조회의 실패 (2026-09-04). 실패하면 `null` 로 접혀
  // 목록이 평면으로 **조용히** 되돌아갔다 — "어느 일지에도 안 묶인 변경"과
  // 구별되지 않는다. 목록 자체는 멀쩡하므로 가리지 않고 카드로만 알린다.
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichNonce, setEnrichNonce] = useState(0);
  // GR4 — change impact: files that (transitively) import a changed file, found
  // by reverse-dependency BFS. Flags review-worthy files the diff doesn't show.
  const [impact, setImpact] = useState<ImpactReport | null>(null);

  const pathKey = changes.map((c) => c.path).join("\n");
  // 최신 목록을 효과 안에서 읽기 위한 창 — 효과는 경로 **집합**(pathKey)이
  // 바뀔 때만 다시 돌고, 워처가 밀어 넣는 매 이벤트마다 다시 묻지 않는다.
  const changesRef = useRef(changes);
  changesRef.current = changes;

  useEffect(() => {
    if (changesRef.current.length === 0) {
      setGroups(null);
      return;
    }
    let cancelled = false;
    setEnrichError(null);
    const paths = changesRef.current.map((c) => c.path);
    commands
      .oculpmGroupChanges(projectId, paths)
      .then((res) => {
        if (cancelled) return;
        setGroups(res.status === "ok" ? res.data : null);
        if (res.status !== "ok") setEnrichError(tError(res.error));
      })
      .catch((e) => {
        if (cancelled) return;
        setGroups(null);
        setEnrichError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, pathKey, enrichNonce]);

  useEffect(() => {
    if (changesRef.current.length === 0) {
      setImpact(null);
      return;
    }
    let cancelled = false;
    const paths = changesRef.current.map((c) => c.path);
    commands
      .getChangeImpact(projectId, paths)
      .then((res) => {
        if (cancelled) return;
        setImpact(res.status === "ok" ? res.data : null);
        if (res.status !== "ok") setEnrichError((prev) => prev ?? tError(res.error));
      })
      .catch((e) => {
        if (cancelled) return;
        setImpact(null);
        setEnrichError((prev) => prev ?? String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, pathKey, enrichNonce]);

  // 그룹 머리글의 확인 토글 — 일지 상세와 같은 쓰기(프런트매터 → 캐시). 성공하면
  // 그룹 상태만 고쳐 다시 묶지 않는다 (검토 루프를 diff 안에서 닫는다, Phase 2).
  const toggleVerified = useCallback(
    async (relativePath: string, next: boolean) => {
      try {
        await oculpmApi.setJournalVerified(projectId, relativePath, next);
        setGroups((prev) =>
          prev
            ? prev.map((g) => (g.entry_path === relativePath ? { ...g, verified_by_user: next } : g))
            : prev,
        );
      } catch (e) {
        toast.destructive(
          t("entry.verifyFailed", { error: e instanceof OculpmApiError ? e.message : String(e) }),
        );
      }
    },
    [projectId, t],
  );

  return {
    changes,
    workingChanges,
    lastCommitChanges,
    baseline,
    pinBaseline: setBaselinePinned,
    lastCommit,
    hasLastCommit,
    listLoading,
    listError,
    retryList: () => setListNonce((n) => n + 1),
    groups,
    impact,
    enrichError,
    retryEnrich: () => setEnrichNonce((n) => n + 1),
    toggleVerified,
  };
}
