/**
 * 「지금 일하는 중」 — 오늘의 작업 세션과, 열려 있는 세션마다 마지막 기록이 언제였는가.
 *
 * 세션은 워처가 연다(파일이 바뀌기 시작하면 열리고, 조용하면 닫힌다). 그래서 **열린
 * 세션 = 지금 무언가가 파일을 고치는 중**이다. 그 세션의 마지막 일지가 오래됐으면
 * 에이전트가 멈췄거나 기록을 잊은 것이다 — 그 한 줄이 이 카드의 일이다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { useJournalEvents } from "@/features/oculpm/useOculpmLive";
import type { JournalEntrySummary, Session } from "@/lib/bindings";
import { safeUnlisten } from "@/lib/unlisten";

/** 마지막 기록에서 이만큼 지나면 경고 톤 한 줄. */
export const QUIET_MINUTES = 30;

export interface LiveSession {
  id: string;
  /** 추정한 에이전트 id (세션의 추정 → 그 세션의 마지막 일지). 모르면 `null`. */
  agentId: string | null;
  /** 이 작업 세션에 붙은 에이전트 대화 수. */
  conversations: number;
  /** 마지막 일지 시각(ms). 아직 없으면 `null`. */
  lastRecordAt: number | null;
  startedAt: number;
}

function linkedTo(session: Session, entry: JournalEntrySummary): boolean {
  if (entry.session_id === session.id) return true;
  return session.linked_journal_entries.some((p) => entry.relative_path.endsWith(p));
}

export function liveSessionsOf(sessions: readonly Session[], entries: readonly JournalEntrySummary[]): LiveSession[] {
  return sessions
    .filter((s) => s.ended_at == null)
    .map((s) => {
      const mine = entries.filter((e) => linkedTo(s, e));
      let last: JournalEntrySummary | null = null;
      for (const e of mine) if (!last || e.created_at > last.created_at) last = e;
      const lastMs = last ? Date.parse(last.created_at) : NaN;
      const started = Date.parse(s.started_at);
      return {
        id: s.id,
        agentId: s.agent_label_guess ?? last?.agent_id ?? null,
        conversations: s.agent_sessions?.length ?? 0,
        lastRecordAt: Number.isNaN(lastMs) ? null : lastMs,
        startedAt: Number.isNaN(started) ? Date.now() : started,
      };
    });
}

export function useLiveSessions(
  projectId: number,
  workday: string | null,
  enabled: boolean,
): { sessions: Session[] | null } {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);
  useJournalEvents(projectId, enabled, bump);

  useEffect(() => {
    if (!enabled || !workday) {
      setSessions(null);
      return;
    }
    let alive = true;
    void Promise.resolve()
      .then(() => oculpmApi.listSessions(projectId, workday))
      .then(
        (rows) => {
          if (alive) setSessions(Array.isArray(rows) ? rows : []);
        },
        () => {
          if (alive) setSessions(null);
        },
      );
    return () => {
      alive = false;
    };
  }, [projectId, workday, enabled, tick]);

  // 세션의 시작·끝은 일지와 따로 온다 (조용해서 닫힌 세션 등).
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const offs: Array<() => void> = [];
    const on = (p: { project_id: number }) => {
      if (p.project_id === projectId) bump();
    };
    for (const pending of [oculpmApi.onSessionStarted(on), oculpmApi.onSessionEnded(on)]) {
      void Promise.resolve(pending)
        .then((off) => {
          if (alive) offs.push(off);
          else safeUnlisten(off);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
      offs.forEach(safeUnlisten);
    };
  }, [projectId, enabled, bump]);

  return useMemo(() => ({ sessions }), [sessions]);
}
