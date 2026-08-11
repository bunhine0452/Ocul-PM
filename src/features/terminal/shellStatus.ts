/**
 * 셸 통합 상태를 상태바 문구로 옮기는 순수 포매터.
 *
 * 렌더 코드에서 분리해 둔 이유는 테스트 때문이다 — 종료코드 표기(0/비0/시그널)와
 * 소요시간 반올림은 눈으로 확인하기 어렵고 조용히 틀리기 쉽다.
 */

import { t } from "@/i18n";

import type { ShellState } from "./oscShell";

/** 상태바에 넣을 명령줄 최대 길이 — 넘으면 가운데를 생략한다. */
const MAX_COMMAND_LENGTH = 32;

/** 셸이 `128 + signo` 로 보고하는 흔한 시그널만. 나머지는 숫자로 남긴다. */
const SIGNAL_NAMES: Readonly<Record<number, string>> = {
  1: "SIGHUP",
  2: "SIGINT",
  3: "SIGQUIT",
  9: "SIGKILL",
  13: "SIGPIPE",
  15: "SIGTERM",
};

/**
 * 소요시간을 사람이 읽는 형태로. 1초 미만은 표시하지 않는다 —
 * `ls` 하나에 "12ms" 가 뜨는 건 정보가 아니라 소음이다.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return "";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return t("term.durSeconds", { n: totalSeconds });
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0
      ? t("term.durMinutes", { m: minutes })
      : t("term.durMinutesSeconds", { m: minutes, s: seconds });
  }
  const hours = Math.floor(minutes / 60);
  return t("term.durHoursMinutes", { h: hours, m: minutes % 60 });
}

/**
 * 긴 명령줄을 가운데 생략으로 줄인다. 앞(실행 파일)과 뒤(대상 경로)가 둘 다
 * 정보라서 뒤만 자르면 `git commit -m 'a…` 처럼 쓸모없는 결과가 된다.
 */
export function truncateCommand(command: string, max = MAX_COMMAND_LENGTH): string {
  const flat = command.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  if (max <= 1) return "…";
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${flat.slice(0, head)}…${tail > 0 ? flat.slice(flat.length - tail) : ""}`;
}

export interface ShellSummary {
  text: string;
  /** 상태바 점 색을 고르는 데 쓴다. */
  tone: "running" | "ok" | "fail" | "idle";
}

/**
 * 상태바 한 칸 분량 요약. 통합이 꺼져 있으면 `null` — 켜지지 않은 기능을
 * 켜진 것처럼 보이게 하느니 아무것도 안 보이는 편이 낫다.
 */
export function summarizeShell(state: ShellState): ShellSummary | null {
  if (!state.active) return null;
  if (state.running) {
    return {
      text: t("term.shellRunning", { command: truncateCommand(state.running.command) }),
      tone: "running",
    };
  }
  const last = state.last;
  if (!last) return { text: t("term.shellActive"), tone: "idle" };

  const duration = formatDuration(last.durationMs);
  const name = truncateCommand(last.command);
  const head = name ? `${name} ` : "";
  if (last.exitCode === null) return { text: `${head}${t("term.shellExited")}`.trim(), tone: "idle" };
  if (last.exitCode === 0) {
    return { text: `${head}${t("term.shellDone")}${duration ? ` · ${duration}` : ""}`, tone: "ok" };
  }
  // 128+N 은 시그널로 죽은 것 — "실패 130" 보다 "SIGINT" 가 훨씬 읽힌다.
  const reason =
    SIGNAL_NAMES[last.exitCode - 128] ?? t("term.shellFailed", { code: last.exitCode });
  return { text: `${head}${reason}${duration ? ` · ${duration}` : ""}`, tone: "fail" };
}
