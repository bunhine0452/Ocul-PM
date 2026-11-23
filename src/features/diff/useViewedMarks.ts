/**
 * 「내가 본 뒤로」(11-23) — 변경 화면의 봤음 표시 한 벌. 사람이 본 파일을 (그때 내용 해시 · 변경 시각)으로
 * 기억하고, 그 뒤 바뀐 것만 목록에 펼친다. 본 것은 목록 끝의 「본 것 N」 한 줄로 접힌다(`ChangeFileList`).
 *
 *  - 열쇠는 내용이다 — 에이전트가 같은 내용으로 다시 쓰면(시각만 늦다) 그대로 본 것이고, 앱이 꺼진 사이에
 *    바뀌었으면 다시 켤 때 읽은 내용이 달라 「본 뒤 바뀜」 으로 다시 선다. 패치 해시였던 때는 공백 무시 토글만으로
 *    해시가 달라졌고, 다른 파일은 패치를 몰라 시각으로만 가렸다(다시 켜면 시각이 0 이라 아무것도 몰랐다).
 *  - 내용은 봤음 기록이 있는 파일만, 그 파일의 변경 시각(또는 보는 중인 본문)이 바뀔 때만 다시 읽는다.
 *  - 영속은 WorkspaceContext(`diffViewed`) — 창이 열린 뒤 처음 한 번 채우고, 그 뒤로는 저장소가 원본이다.
 *  - 목록에서 사라진 파일(커밋됨)의 기록은 걷는다. 최근 커밋의 기록은 그 커밋일 때만 산다(`last_commit:<sha>`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorDetail } from "@/api/invoke";
import { projectFileApi } from "@/api/projectFile";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { RecentChange } from "@/lib/recentChangesStore";
import type { DiffBaseline } from "./changeList";
import { isNotFoundError } from "./diffNoteStore";
import {
  GONE_HASH,
  hydrateViewed,
  patchHash,
  pruneViewed,
  setViewed,
  splitViewedKey,
  useViewed,
  viewStateOf,
  viewedKey,
  viewedOf,
  viewedRecord,
  type ContentNow,
  type ViewState,
} from "./diffSessionStore";

interface ViewedMarksInput {
  projectId: number;
  baseline: DiffBaseline;
  /** 최근 커밋의 sha — 그 기준선의 열쇠가 커밋마다 다르다. */
  commitSha: string | null;
  changes: readonly RecentChange[];
  /** 커밋 전 변경 — 여기 없는 파일의 커밋 전 기록은 걷는다. */
  workingChanges: readonly RecentChange[];
  /** 목록을 믿을 수 있다(첫 답이 왔고 실패가 아니다) — 그때만 걷는다. */
  listSettled: boolean;
  /** 보는 중인 본문 — 그 패치가 바뀌면 내용을 다시 읽는다. */
  focusPath: string | null;
  focusPatch: string | null;
}

export interface ViewedMarks {
  viewStateFor: (path: string) => ViewState;
  toggle: (path: string) => void;
  /** 지금 본 것으로 서는 파일 수. */
  viewedCount: number;
}

/** 파일 내용을 해시로. 못 읽으면 `null`(바이너리 · 권한) — 지운 파일만 「없음」 이 하나의 내용이다. */
async function readHash(projectId: number, path: string, deleted: boolean): Promise<string | null> {
  try {
    return patchHash(await projectFileApi.read(projectId, path));
  } catch (e) {
    return deleted && isNotFoundError(errorDetail(e)) ? GONE_HASH : null;
  }
}

export function useViewedMarks(input: ViewedMarksInput): ViewedMarks {
  const { projectId, baseline, commitSha, changes, workingChanges, listSettled, focusPath, focusPatch } = input;
  const { state, setState } = useWorkspace();
  const map = useViewed(projectId);
  const base = baseline === "last_commit" ? `last_commit:${commitSha ?? ""}` : "working";
  const byPath = useMemo(() => new Map(changes.map((c) => [c.path, c] as const)), [changes]);

  // 영속 — 창이 열린 뒤 처음 한 번 채우고, 그 뒤로는 바뀔 때마다 적는다.
  // 채운 그 커밋의 적기는 건너뛴다 — 그 자리의 `map` 은 채우기 전 값이라 저장된 기록을 빈 값으로 덮는다.
  const justHydrated = useRef(false);
  useEffect(() => {
    hydrateViewed(projectId, state.diffViewed);
    justHydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => {
    if (justHydrated.current) {
      justHydrated.current = false;
      return;
    }
    const next = viewedRecord(map);
    const prev = state.diffViewed ?? {};
    if (JSON.stringify(next) !== JSON.stringify(prev)) setState((s) => ({ ...s, diffViewed: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // 목록에서 사라진 파일의 기록을 걷는다 — 커밋 전 기록은 커밋 전 목록으로, 최근 커밋 기록은 그 커밋으로.
  useEffect(() => {
    if (!listSettled) return;
    const working = new Set(workingChanges.map((c) => c.path));
    pruneViewed(projectId, (key) => {
      const { baseline: b, path } = splitViewedKey(key);
      if (b === "working") return working.has(path);
      return commitSha == null || b === `last_commit:${commitSha}`;
    });
  }, [projectId, listSettled, workingChanges, commitSha]);

  // 지금 내용 — 커밋 전 기준선에서 봤음 기록이 있는 파일만. 열쇠 조각(변경 시각 · 보는 중인 패치)이 바뀐 파일만 다시 읽는다.
  const [now, setNow] = useState<ReadonlyMap<string, ContentNow>>(() => new Map());
  const asked = useRef(new Map<string, string>());
  const focusHash = focusPatch != null ? patchHash(focusPatch) : "";
  const wanted = useMemo(() => {
    if (base !== "working") return [];
    const out: Array<{ path: string; ts: number; part: string; deleted: boolean }> = [];
    for (const key of map.keys()) {
      const { baseline: b, path } = splitViewedKey(key);
      const c = byPath.get(path);
      if (b !== "working" || !c) continue;
      out.push({ path, ts: c.ts, part: `${c.ts}\t${path === focusPath ? focusHash : ""}`, deleted: c.op === "D" });
    }
    return out;
  }, [base, map, byPath, focusPath, focusHash]);
  useEffect(() => {
    const sent = asked.current;
    const due = wanted.filter((w) => sent.get(w.path) !== w.part);
    if (due.length === 0) return;
    for (const w of due) sent.set(w.path, w.part);
    let alive = true;
    let done = false;
    void Promise.all(due.map(async (w) => [w, await readHash(projectId, w.path, w.deleted)] as const)).then((pairs) => {
      done = true;
      if (!alive) return;
      // 해시 없이 막 누른 기록은 그 판의 내용으로 채운다(누른 때와 읽은 때의 변경 시각이 같을 때만).
      for (const [w, hash] of pairs) {
        const key = viewedKey("working", w.path);
        const rec = viewedOf(projectId, key);
        if (hash != null && rec && rec.hash === "" && rec.ts === w.ts) setViewed(projectId, key, { hash, ts: rec.ts });
      }
      setNow((prev) => {
        const next = new Map(prev);
        for (const [w, hash] of pairs) {
          if (hash == null) next.delete(w.path);
          else next.set(w.path, { hash, at: w.ts });
        }
        return next;
      });
    });
    return () => {
      alive = false;
      // 끝나기 전에 걷혔으면 다음 번에 다시 읽게 한다.
      if (!done) for (const w of due) if (sent.get(w.path) === w.part) sent.delete(w.path);
    };
  }, [wanted, projectId]);

  const viewStateFor = useCallback(
    (path: string) => viewStateOf(map.get(viewedKey(base, path)), byPath.get(path), base === "working" ? now.get(path) : null),
    [map, base, byPath, now],
  );

  const toggle = useCallback(
    (path: string) => {
      const key = viewedKey(base, path);
      if (viewStateFor(path) === "viewed") {
        setViewed(projectId, key, null);
        return;
      }
      const change = byPath.get(path);
      const ts = change?.ts ?? 0;
      if (base !== "working") {
        setViewed(projectId, key, { hash: base, ts });
        return;
      }
      // 먼저 시각으로 세운다(누른 순간 선다). 해시는 내용 읽기가 채운다 — 기록이 생기면 읽을 파일에 든다.
      asked.current.delete(path);
      setViewed(projectId, key, { hash: "", ts });
    },
    [base, viewStateFor, projectId, byPath],
  );

  const viewedCount = changes.filter((c) => viewStateFor(c.path) === "viewed").length;
  return { viewStateFor, toggle, viewedCount };
}
