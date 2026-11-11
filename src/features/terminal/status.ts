/**
 * 터미널 세션의 상태 말 — 세션 안 프로그램(주로 claude)이 OSC 7501 로 알린 상태
 * (`src-tauri/src/program_status.rs`)를 사람 말로 옮기고, 모든 창의 세션을 프로젝트별로 센다.
 *
 * xterm 을 들이지 않는다 — 윗줄의 프로젝트 목록 · 시작 창이 터미널 화면 없이 쓴다.
 */
import { useEffect, useState } from "react";

import { terminalApi, type TermInfo, type TermStatus } from "@/api/terminal";
import type { I18nKey, TVars } from "@/i18n";

type Tr = (key: I18nKey, vars?: TVars) => string;

/** 내 손을 기다리는 상태 — 권한 · 질문 · 로그인. */
export function needsMe(status: TermStatus | null): boolean {
  return status?.state === "blocked";
}

function stateWord(tr: Tr, status: TermStatus): string {
  switch (status.state) {
    case "working":
      return tr("terminal.state.working");
    case "idle":
      return tr("terminal.state.idle");
    case "done":
      return tr("terminal.state.done");
    case "error":
      return tr("terminal.state.error");
    case "blocked":
      if (status.kind === "permission") return tr("terminal.state.permission");
      if (status.kind === "question") return tr("terminal.state.question");
      if (status.kind === "auth") return tr("terminal.state.auth");
      return tr("terminal.state.blocked");
    default:
      return tr("terminal.running");
  }
}

/**
 * 일지 없이 끝남 (11-02) — 안의 Claude 가 일했고(`worked`) 지금은 끝났거나 손을 놓았는데(끝 · done · idle),
 * 이 세션이 시작된 뒤 일지가 0건. 코드를 안 바꾼 문답이어도 서므로 경고가 아니라 「확인해 볼 것」 이다.
 */
export function endedWithoutRecord(info: TermInfo, worked: boolean, records: number): boolean {
  if (!worked || records > 0) return false;
  if (!info.alive) return true;
  return info.status?.state === "done" || info.status?.state === "idle";
}

/** 목록 한 줄의 상태 — 끝났으면 종료 코드, 상태를 알리는 프로그램이면 그 상태, 아니면 「실행 중」. */
export function sessionWord(tr: Tr, info: TermInfo): string {
  if (!info.alive) {
    return info.exit_code != null ? tr("terminal.ended", { code: info.exit_code }) : tr("terminal.endedUnknown");
  }
  return info.status ? stateWord(tr, info.status) : tr("terminal.running");
}

/**
 * 목록 명령(`term_list` · `term_overview`)은 봉투 없이 배열을 준다 — 배열이 아니면(웹뷰가 아닌 곳 ·
 * 낡은 다리) 빈 목록으로 접는다. 터미널 목록을 못 읽었다고 오늘 화면이 죽으면 안 된다.
 */
function asList(infos: unknown): TermInfo[] {
  return Array.isArray(infos) ? (infos as TermInfo[]) : [];
}

export interface ProjectTerms {
  alive: number;
  waiting: number;
  /** 그 창이 뒤에 있는 동안 Claude 가 끝내거나 기다리기 시작했고 아직 그 창을 안 봤다. */
  unseen: boolean;
}

/**
 * 무언가 도는 세션을 프로젝트별로 센다 — 빈 셸과 끝난 세션은 세지 않는다(`busy`). 읽지 않은 소식은
 * 세션이 끝났어도 남는다(claude 가 끝내고 나간 뒤에도 「새 소식」).
 */
export function countByProject(infos: TermInfo[]): Map<number, ProjectTerms> {
  const out = new Map<number, ProjectTerms>();
  for (const s of infos) {
    if (!s.busy && !s.unseen) continue;
    const row = out.get(s.project_id) ?? { alive: 0, waiting: 0, unseen: false };
    if (s.busy) {
      row.alive += 1;
      if (needsMe(s.status)) row.waiting += 1;
    }
    if (s.unseen) row.unseen = true;
    out.set(s.project_id, row);
  }
  return out;
}

/**
 * `TermSessionsChanged` 가 몰려 와도(상태 신호 · 열고 닫기 · 여러 창의 세션) 다시 읽기는 이 간격에 한 번.
 * 목록을 읽을 때마다 백엔드가 「도는 중」 을 재는데(Windows 는 프로세스 스냅숏), 사건마다 읽으면 창 셋 ·
 * 훅 둘이 같은 순간에 줄지어 물었다(2026-11-11). 첫 사건에서 시계를 걸고, 그 안의 사건은 그 한 번에 담긴다
 * — 계속 와도 읽기가 밀리지 않는다.
 */
export const REFETCH_COALESCE_MS = 150;

/** `fn` 을 `ms` 뒤 한 번 — 그 사이 다시 불러도 그 한 번에 담긴다. `cancel` 은 걸린 것을 버린다. */
export function coalesce(fn: () => void, ms = REFETCH_COALESCE_MS): { call: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call: () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** 이 창의 세션 — 처음 한 번 읽고, 어느 창에서든 세션 · 상태가 바뀌면 다시 읽는다(`REFETCH_COALESCE_MS`). */
export function useWindowTerms(enabled = true): TermInfo[] {
  const [list, setList] = useState<TermInfo[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      void terminalApi
        .list()
        .then((infos) => alive && setList(asList(infos)))
        .catch(() => {});
    load();
    const later = coalesce(load);
    const off = terminalApi.onSessionsChanged(later.call);
    return () => {
      alive = false;
      later.cancel();
      void off.then((fn) => fn());
    };
  }, [enabled]);
  return list;
}

/**
 * 모든 창의 세션 — 처음 한 번, 어느 창에서든 세션 · 상태가 바뀔 때, `refresh` 가 바뀔 때 읽는다.
 * 빈 셸에서 명령이 시작 · 끝나는 것은 사건이 없으니 목록을 펼칠 때 `refresh` 로 다시 읽게 한다.
 */
export function useTermOverview(refresh?: unknown): Map<number, ProjectTerms> {
  const [counts, setCounts] = useState<Map<number, ProjectTerms>>(() => new Map());
  useEffect(() => {
    let alive = true;
    const load = () =>
      void terminalApi
        .overview()
        .then((infos) => alive && setCounts(countByProject(asList(infos))))
        .catch(() => {});
    load();
    const later = coalesce(load);
    const off = terminalApi.onSessionsChanged(later.call);
    return () => {
      alive = false;
      later.cancel();
      void off.then((fn) => fn());
    };
  }, [refresh]);
  return counts;
}
