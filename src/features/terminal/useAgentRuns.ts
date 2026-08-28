import { useCallback, useEffect, useRef, useState } from "react";
import { commands } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { oculpmLog } from "@/lib/oculpmLog";
import { requestManualEntry } from "@/lib/journalCompose";
// 모듈 t() — `proposeJournalEntry` 는 훅이 아닌 순수 헬퍼라 useT() 를 쓸 수 없다.
import { t } from "@/i18n";
import { detectAgent, type AgentRun } from "./agentDetect";
import { formatDuration } from "./shellStatus";
import type { ShellState } from "./oscShell";

/**
 * 셸 통합이 알려준 명령 경계에서 **코딩 에이전트 실행**을 추적한다
 * (2026-07-30).
 *
 * 셸 통합이 꺼져 있으면 이 훅은 아무 일도 하지 않는다 — 이전 툴바 문구가
 * 주장하던 "에이전트 실행 감지"는 실제로는 존재하지 않는 기능이었다.
 *
 * # 왜 바로 신호를 보내지 않는가
 *
 * `claude --version` 처럼 즉시 끝나는 호출까지 세션으로 만들면 유령 세션이
 * 쌓인다(도그푸딩에서 이미 겪은 실패다). 그래서 **[`MIN_RUN_MS`] 이상 살아
 * 있을 때만** 시작 신호를 보내고, 시작을 안 보냈으면 종료도 안 보낸다.
 *
 * # 자동으로 일지를 쓰지 않는다
 *
 * 터미널에서 띄운 에이전트는 transcript 가 없어 요약할 재료가 없다. 그래서
 * 몰래 쓰는 대신 **제안만** 한다 — 사용자가 누르면 작성기가 열린다.
 *
 * # 토스트와 카드를 둘 다 남기는 이유 (2026-08-28)
 *
 * 토스트는 **다른 화면에 있을 때** 닿는다. 세션 카드는 터미널로 돌아왔을 때
 * **아직 거기 있다**. 둘은 경쟁하지 않는다 — 하나는 알림이고 하나는 손잡이다.
 * 토스트만 두면 자리를 비운 사이에 사라지고, 카드만 두면 도크를 닫아 둔 사람
 * 에게는 아무 일도 일어나지 않는다.
 */

/** 이 시간 이상 살아 있어야 "에이전트 실행"으로 친다. */
const MIN_RUN_MS = 15_000;

/** 제안 토스트를 띄우는 최소 실행 시간 — 짧은 실행은 남길 이야기가 없다. */
const PROPOSE_AFTER_MS = 60_000;

interface TrackedRun {
  agent: AgentRun;
  /** 문턱을 넘기면 시작 신호를 쏘는 타이머. 이미 쐈으면 null. */
  timer: number | null;
  /** 시작 신호를 실제로 보냈는가 (보냈을 때만 종료 신호를 보낸다). */
  signaled: boolean;
}

/** 방금 끝난 실행 — 세션 카드가 "일지 남기기" 손잡이를 그리는 재료. */
export interface FinishedRun {
  agentLabel: string;
  /** 이미 사람이 읽는 형태로 포맷된 소요 시간. 빈 문자열이면 1초 미만. */
  duration: string;
}

export interface AgentRunsResult {
  /** sid → 방금 끝난 실행. 같은 페인에서 다음 명령이 시작하면 사라진다. */
  finished: Record<string, FinishedRun>;
  /** 사용자가 카드를 치웠다. */
  dismiss: (sid: string) => void;
}

/**
 * @param shellStates sid → 셸 상태 (TerminalSurface 가 페인별로 모은 것)
 * @param projectId 현재 프로젝트. 없으면 신호를 보내지 않는다.
 */
export function useAgentRuns(
  shellStates: Record<string, ShellState>,
  projectId: number | null,
): AgentRunsResult {
  const runsRef = useRef(new Map<string, TrackedRun>());
  const [finished, setFinished] = useState<Record<string, FinishedRun>>({});
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  useEffect(() => {
    const runs = runsRef.current;

    const signal = (started: boolean, agent: AgentRun) => {
      const pid = projectIdRef.current;
      if (pid == null) return;
      void commands.oculpmAgentRunSignal(pid, started, agent.id).then((res) => {
        if (res.status === "error") {
          // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
          oculpmLog.error("terminal", `에이전트 세션 신호 실패: ${res.error}`);
        }
      });
    };

    for (const [sid, state] of Object.entries(shellStates)) {
      const tracked = runs.get(sid);
      const runningAgent = state.running ? detectAgent(state.running.command) : null;

      // 같은 실행이 계속되는 중 — 아무것도 하지 않는다.
      if (tracked && runningAgent && tracked.agent.id === runningAgent.id) continue;

      // 직전 실행이 끝났다(또는 다른 명령으로 바뀌었다).
      if (tracked) {
        if (tracked.timer !== null) window.clearTimeout(tracked.timer);
        if (tracked.signaled) {
          signal(false, tracked.agent);
          proposeJournalEntry(tracked.agent, state);
          const last = state.last;
          if (last && last.durationMs >= PROPOSE_AFTER_MS) {
            setFinished((prev) => ({
              ...prev,
              [sid]: { agentLabel: tracked.agent.label, duration: formatDuration(last.durationMs) },
            }));
          }
        }
        runs.delete(sid);
      }

      if (!runningAgent) continue;
      // 같은 페인에서 새 명령이 시작했다 — 지난 실행의 카드는 이제 과거다.
      setFinished((prev) => {
        if (!(sid in prev)) return prev;
        const next = { ...prev };
        delete next[sid];
        return next;
      });
      const entry: TrackedRun = { agent: runningAgent, timer: null, signaled: false };
      entry.timer = window.setTimeout(() => {
        entry.timer = null;
        entry.signaled = true;
        signal(true, runningAgent);
      }, MIN_RUN_MS);
      runs.set(sid, entry);
    }

    // 페인이 통째로 사라진 경우(탭 닫기) — 타이머만 정리한다. 종료 신호는
    // 보내지 않는다: 세션이 실제로 끝났는지 알 수 없고 비활동 타임아웃이
    // 어차피 닫는다. 없는 사실을 지어내지 않는 쪽을 택한다.
    for (const [sid, tracked] of runs) {
      if (sid in shellStates) continue;
      if (tracked.timer !== null) window.clearTimeout(tracked.timer);
      runs.delete(sid);
    }

    // 사라진 페인의 카드도 회수한다 — 안 그러면 맵이 무한정 자란다.
    setFinished((prev) => {
      const stale = Object.keys(prev).filter((sid) => !(sid in shellStates));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const sid of stale) delete next[sid];
      return next;
    });
  }, [shellStates]);

  const dismiss = useCallback((sid: string) => {
    setFinished((prev) => {
      if (!(sid in prev)) return prev;
      const next = { ...prev };
      delete next[sid];
      return next;
    });
  }, []);

  // 언마운트 — 대기 중인 타이머만 정리한다.
  useEffect(() => {
    const runs = runsRef.current;
    return () => {
      for (const tracked of runs.values()) {
        if (tracked.timer !== null) window.clearTimeout(tracked.timer);
      }
      runs.clear();
    };
  }, []);

  return { finished, dismiss };
}

/**
 * 에이전트 실행이 끝났다 — 일지를 남길지 **묻는다**. 충분히 오래 돌았을 때만.
 * 자동 작성은 하지 않는다 (터미널 실행은 요약할 transcript 가 없다).
 */
function proposeJournalEntry(agent: AgentRun, state: ShellState): void {
  const last = state.last;
  if (!last || last.durationMs < PROPOSE_AFTER_MS) return;
  const spent = formatDuration(last.durationMs);
  const headline = spent
    ? t("term.agentFinishedIn", { agent: agent.label, duration: spent })
    : t("term.agentFinished", { agent: agent.label });
  toast.info(headline, {
    title: t("term.agentJournalPrompt"),
    dedupKey: `agent-run-${agent.id}`,
    actions: [{ label: t("term.agentJournalAction"), onClick: () => requestManualEntry() }],
  });
}
