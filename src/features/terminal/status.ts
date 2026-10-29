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

/** 목록 한 줄의 상태 — 끝났으면 종료 코드, 상태를 알리는 프로그램이면 그 상태, 아니면 「실행 중」. */
export function sessionWord(tr: Tr, info: TermInfo): string {
  if (!info.alive) {
    return info.exit_code != null ? tr("terminal.ended", { code: info.exit_code }) : tr("terminal.endedUnknown");
  }
  return info.status ? stateWord(tr, info.status) : tr("terminal.running");
}

export interface ProjectTerms {
  alive: number;
  waiting: number;
}

/** 무언가 도는 세션을 프로젝트별로 센다 — 빈 셸과 끝난 세션은 세지 않는다(`busy`). */
export function countByProject(infos: TermInfo[]): Map<number, ProjectTerms> {
  const out = new Map<number, ProjectTerms>();
  for (const s of infos) {
    if (!s.busy) continue;
    const row = out.get(s.project_id) ?? { alive: 0, waiting: 0 };
    row.alive += 1;
    if (needsMe(s.status)) row.waiting += 1;
    out.set(s.project_id, row);
  }
  return out;
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
        .then((infos) => alive && setCounts(countByProject(infos)))
        .catch(() => {});
    load();
    const off = terminalApi.onSessionsChanged(load);
    return () => {
      alive = false;
      void off.then((fn) => fn());
    };
  }, [refresh]);
  return counts;
}
