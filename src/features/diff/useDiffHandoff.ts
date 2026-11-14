/**
 * 다른 화면에서 건너온 한 번짜리 지정(`diffActivePath`)을 푼다 (11-15 #diff-handoff).
 *
 * 파일 경로면 그 파일을 고른다. 일지 상세의 「변경 diff 화면에서 보기」 는 **일지 경로**
 * (`20261114/…/x.md`)를 같은 자리에 실어 보낸다 — 파일 경로로 읽으면 절대 맞을 수 없어 아무 최근
 * 파일이 열렸다. 보내는 쪽은 그대로 두고 받는 쪽이 가른다: 일지 경로면 그 일지의 묶음을 펼쳐 첫
 * 파일, 묶음에 없으면 그 일지의 `files_touched` 가운데 지금 변경에 있는 첫 파일, 그것도 없으면
 * 그렇다고 말한다. 일지 경로는 묶음을 알 때까지(`ready`) 기다렸다가 한 번만 쓴다.
 *
 * 끝나면 `onDone(골랐나)` — 화면은 고른 것을 처음 고르기로 덮지 않고, 못 골랐을 때만 처음 고르기를 돌린다.
 * `files_touched` 를 묻는 동안 사람이 파일을 골랐거나 화면을 떠났으면 늦은 답은 버린다(사람이 j/k 로
 * 고른 파일을 덮었고, 떠난 뒤에도 「없어요」 토스트가 떴다).
 */
import { useEffect, useRef, type RefObject } from "react";

import { oculpmApi } from "@/api/oculpm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { normalizeJournalRef } from "@/features/oculpm/useJournalPlanLinks";
import { useT } from "@/i18n";
import type { RecentChange } from "@/lib/recentChangesStore";
import { toast } from "@/lib/toast";
import { groupKey, type ChangeBuckets } from "./changeGroups";

const JOURNAL_REF = /^\d{8}\/.+\.md$/;

/** 일지 경로인가 — `.oculpm/journal/` 접두가 붙어 와도. */
export function isJournalRef(path: string): boolean {
  return JOURNAL_REF.test(normalizeJournalRef(path));
}

export function useDiffHandoff({
  projectId,
  buckets,
  changes,
  ready,
  select,
  expand,
  handPicks,
  onDone,
}: {
  projectId: number;
  buckets: ChangeBuckets;
  changes: readonly RecentChange[];
  /** 목록과 묶음을 다 물었다(또는 더 기다리지 않는다). */
  ready: boolean;
  select: (path: string) => void;
  expand: (groupKey: string) => void;
  /** 사람이 파일을 고른 횟수 — 늦게 온 답이 그 사이의 선택을 덮지 않게. */
  handPicks: RefObject<number>;
  /** 건너오기가 끝났다 — 파일을 골랐으면(사람이 그 사이 골랐어도) true. */
  onDone: (picked: boolean) => void;
}): void {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const target = state.diffActivePath;
  const changesRef = useRef(changes);
  changesRef.current = changes;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    const consume = () => setState((prev) => ({ ...prev, diffActivePath: null }));
    if (!isJournalRef(target)) {
      select(target);
      consume();
      onDone(true);
      return;
    }
    if (!ready) return;
    consume();
    const ref = normalizeJournalRef(target);
    const group = buckets.groups.find((g) => g.entry_path != null && normalizeJournalRef(g.entry_path) === ref);
    if (group) {
      expand(groupKey(group));
      select(group.files[0]);
      onDone(true);
      return;
    }
    const picks = handPicks.current;
    const answer = (hit: string | null) => {
      if (!alive.current) return;
      // 그 사이 사람이 골랐으면 그 선택이 처음 고르기다 — 늦은 답으로 덮지 않는다.
      if (handPicks.current !== picks) return onDone(true);
      if (hit) select(hit);
      else toast.info(t("diff.handoffMissing"));
      onDone(hit != null);
    };
    void Promise.resolve()
      .then(() => oculpmApi.getJournalEntry(projectId, ref))
      .then((entry) => {
        const present = new Set(changesRef.current.map((c) => c.path));
        answer(entry?.frontmatter.files_touched.map((f) => f.path).find((p) => present.has(p)) ?? null);
      })
      .catch(() => answer(null));
  }, [target, ready, buckets, projectId, select, expand, setState, t, handPicks, onDone]);
}
