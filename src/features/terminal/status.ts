/**
 * 터미널 세션의 상태 말 — 세션 안 프로그램(주로 claude)이 OSC 7501 로 알린 상태
 * (`src-tauri/src/program_status.rs`)를 사람 말로 옮기고, 모든 창의 세션을 프로젝트별로 센다.
 *
 * xterm 을 들이지 않는다 — 윗줄의 프로젝트 목록 · 시작 창이 터미널 화면 없이 쓴다.
 */
import { useEffect, useState } from "react";

import { terminalApi, type TermInfo, type TermStatus } from "@/api/terminal";
import type { I18nKey, TVars } from "@/i18n";
import { laneNumberOf } from "./race";

type Tr = (key: I18nKey, vars?: TVars) => string;

/** 내 손을 기다리는 상태 — 권한 · 질문 · 로그인. */
export function needsMe(status: TermStatus | null): boolean {
  return status?.state === "blocked";
}

/**
 * 「작업 중」 인데 이만큼 아무 소식(출력 · 상태 사건)이 없으면 「최근 소식 없음」 — 30분 넘게 말이 없는
 * 「작업 중」 을 믿고 기다리지 않게. 멈췄는지는 화면을 봐야 안다.
 */
export const QUIET_AFTER_MS = 30 * 60_000;

// 세션마다 마지막 활동(출력 조각 · 상태 사건) 시각 — 창(웹뷰) 하나에 하나. 적는 쪽은 세션의 사건을 받는
// 엔진(`termStore` 의 사건 처리)이고, 세션을 닫으면 버린다. `status.since` 는 「그 상태로 들어선 시각」 이라 쉬지
// 않고 출력하는 긴 턴도 30분이 지나면 멈춘 것처럼 말했다.
const activity = new Map<number, number>();

/** 세션에 출력 · 상태 사건이 왔다 — 엔진이 부른다. */
export function noteTermActivity(id: number, at = Date.now()): void {
  activity.set(id, at);
}

/** 세션을 닫았다 — 그 세션의 활동 시각을 버린다(`closeTerm`). */
export function forgetTermActivity(id: number): void {
  activity.delete(id);
}

/**
 * working 인데 마지막 활동 뒤로 `QUIET_AFTER_MS` 가 넘었다. 활동 시각을 모르면(엔진이 아직 안 적었으면)
 * 아니다 — 모르는 것을 「소식 없음」 이라 말하지 않는다.
 */
export function isQuiet(info: TermInfo, now = Date.now()): boolean {
  if (info.status?.state !== "working") return false;
  const last = activity.get(info.id);
  return last != null && now - last > QUIET_AFTER_MS;
}

function stateWord(tr: Tr, info: TermInfo, status: TermStatus): string {
  switch (status.state) {
    case "working":
      return isQuiet(info) ? tr("terminal.state.quiet") : tr("terminal.state.working");
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
  return info.status ? stateWord(tr, info, info.status) : tr("terminal.running");
}

/** 엔진이 싣는 OSC 제목 · 안의 프로그램 이름 — 합류 전에도 컴파일되게 선택 속성으로 읽는다. */
type TitledInfo = TermInfo & { title?: string | null };
type AppStatus = TermStatus & { app?: string | null };

/**
 * 안의 프로그램이 Claude 인가 — 엔진이 알린 이름(`status.app`, OSC 7501)이 있으면 그것으로 가린다.
 * 상태 신호만 보면 Codex 세션도 끼어 Claude 에게 쓴 지시가 Codex 로 갈 수 있었다. 이름을 안 알리는
 * 프로그램(엔진 합류 전 · 옛 판)은 예전처럼 믿는다. 규칙은 엔진의 `runs_claude` 와 같은 모양이다 —
 * 엔진이 소문자로 다듬은 이름이 `claude`(· `claude-code`)로 시작하면 Claude. 「보내기」 의 받는 곳과
 * 상태 띠의 「기록 남기게 하기」 가 같은 판정을 쓴다.
 */
export function isClaudeApp(s: TermInfo): boolean {
  const app = (s.status as AppStatus | null)?.app;
  return app == null || app.startsWith("claude");
}

/** 안의 프로그램이 붙인 제목(OSC 0/2) — 없으면 `null`. */
export function oscTitle(info: TermInfo): string | null {
  return (info as TitledInfo).title?.trim() || null;
}

/**
 * 세션 이름 — 레인이면 「시도 n」, 아니면 안의 프로그램이 붙인 제목(OSC), 프로그램 이름, 셸 이름 순.
 * 레인을 맨 앞에 두는 것은 띠와 탭이 같은 이름으로 불러야 해서다 — 같은 프롬프트로 돈 셋은 제목도 같다.
 */
export function sessionName(tr: Tr, info: TermInfo): string {
  const lane = laneNumberOf(info.id);
  if (lane != null) return tr("race.lane", { n: lane });
  const title = oscTitle(info);
  if (title) return title;
  const app = (info.status as AppStatus | null)?.app?.trim();
  return app || info.label;
}

// 세션 번호 — 창(웹뷰) 하나에 하나, 모듈 범위. 백엔드 id 는 모든 창이 나눠 쓰는 차례라 화면에 없는 수다.
const numbers = new Map<number, number>();
let lastNumber = 0;

/**
 * 창 안에서 연 순서(1부터) — 닫혀도 그 번호는 다시 쓰지 않는다. 탭 앞 숫자 · 칸 머리 · 닫기 확인 · 창 닫기
 * 확인 · 「Claude 에게 보내기」 의 받는 곳과 그 토스트(변경 화면의 「Claude 에게 맡기기」 도 그 대화상자를 지난다)가
 * 같은 번호를 부른다. OS 알림의 제목은 번호 없이 탭과 같은 이름(`sessionName`)이다.
 */
export function sessionNumber(id: number): number {
  let n = numbers.get(id);
  if (n == null) {
    n = ++lastNumber;
    numbers.set(id, n);
  }
  return n;
}

/** 목록 전체를 연 순서(id 순)로 먼저 매긴다 — 일부(받는 곳만)를 먼저 본 쪽이 번호를 가로채지 않게. */
export function numberSessions(list: readonly TermInfo[]): void {
  for (const id of list.map((s) => s.id).sort((a, b) => a - b)) sessionNumber(id);
}

/** 「2 claude」 — 닫기 확인 · 접근명이 탭과 같은 이름으로 부른다. */
export function sessionLabel(tr: Tr, info: TermInfo): string {
  return `${sessionNumber(info.id)} ${sessionName(tr, info)}`;
}

/** 테스트 전용 — 창 하나의 수명을 흉내 낸다. */
export function __resetSessionNumbersForTests() {
  numbers.clear();
  lastNumber = 0;
  activity.clear();
}

/** 점의 모양 — 살아 있음(회색) · 기다림(앰버 + 고리) · 끝남(빈 고리) · 실패(빨강). */
export type SessionMark = "live" | "wait" | "ended" | "fail";

export interface SessionView {
  mark: SessionMark;
  /** 보이는 낱말 — 예외일 때만(기다림 사유 · 끝남 코드 · 최근 소식 없음). 평상이면 `null`. */
  word: string | null;
  tone: "warn" | "danger" | null;
  /** 일지 없이 끝남 — 낱말 「일지 없음」 과 앰버 점이 따로 붙는다. */
  norec: boolean;
  /** 평상 낱말(실행 중 · 작업 중 · 입력을 기다려요) — 툴팁에만. */
  plain: string;
}

/**
 * 탭 · 칸 머리 · 띠가 같은 말을 하게 한 곳에서 판정한다 (영수증 규칙 1 — 색은 예외에만, 규칙 4 — 같은 뜻은
 * 같은 모양). 평상 낱말은 보이지 않고 툴팁으로, 살아 있는 세션의 점은 회색이다.
 */
export function sessionView(tr: Tr, info: TermInfo, worked: boolean, records: number): SessionView {
  const plain = sessionWord(tr, info);
  const norec = endedWithoutRecord(info, worked, records);
  if (!info.alive) {
    const failed = info.exit_code != null && info.exit_code !== 0;
    return { mark: failed ? "fail" : "ended", word: plain, tone: failed ? "danger" : null, norec, plain };
  }
  if (needsMe(info.status)) return { mark: "wait", word: plain, tone: "warn", norec, plain };
  if (info.status?.state === "error") return { mark: "fail", word: plain, tone: "danger", norec, plain };
  if (isQuiet(info)) return { mark: "live", word: plain, tone: null, norec, plain };
  return { mark: "live", word: null, tone: null, norec, plain };
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

/** 이 창의 세션 목록과 읽은 상태 — 아직 못 읽었는가(`loading`) · 읽다 실패했는가(`failed`). */
export interface WindowTerms {
  list: TermInfo[];
  state: "loading" | "ready" | "failed";
}

/** 아직 못 읽은 목록 — 꺼질 때 이리로 돌아간다. */
const UNREAD: WindowTerms = { list: [], state: "loading" };

/** 값이 같은가 — 목록은 IPC 가 부를 때마다 새 배열 · 새 객체로 준다. 백엔드가 칸을 더해도 따라간다. */
function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** 읽은 답 — 목록, 못 읽었으면 `null`. */
type TermsAnswer = TermInfo[] | null;

/**
 * 이 창의 세션 목록을 읽는 한 곳 (11-22) — 창(웹뷰) 하나에 하나, 모듈 범위.
 *
 * 프로젝트 창에는 이 목록을 읽는 훅이 셋이다(셸의 터미널 점 · 셸의 오늘 배지 · 오늘 화면, 열면 「Claude 에게
 * 보내기」 까지 넷). 훅마다 사건을 듣고 저마다 읽던 때는 사건 한 묶음에 `term_list` 가 셋 갔다 — 읽을 때마다
 * 백엔드가 「도는 중」 을 재는데(Windows 는 프로세스 스냅숏) 같은 답을 세 번 쟀다. 이제 사건은 여기서 한 번
 * 듣고 한 번 읽어 듣는 훅 모두에게 준다.
 *
 * - 사건이 부른 읽기는 늘 새로 읽는다(읽는 중인 것에 얹지 않는다 — 그 읽기는 이 사건보다 먼저 떠났다).
 * - 훅이 켜지며 부른 읽기는 읽는 중인 것이 있으면 거기 얹는다(같은 틱에 선 훅 셋이 한 번만 읽는다).
 * - 답에는 번호가 있다 — 먼저 떠난 느린 읽기가 뒤늦게 와도 새 목록을 덮지 않는다.
 * - 듣는 훅이 없으면 사건도 듣지 않는다.
 */
const windowTermsHub = (() => {
  const listeners = new Set<(answer: TermsAnswer) => void>();
  let off: Promise<() => void> | null = null;
  let sent = 0;
  let applied = 0;
  let flying: Promise<void> | null = null;

  const read = (): Promise<void> => {
    const n = ++sent;
    const deliver = (answer: TermsAnswer) => {
      if (n <= applied) return;
      applied = n;
      for (const fn of [...listeners]) fn(answer);
    };
    const p: Promise<void> = Promise.resolve()
      .then(() => terminalApi.list())
      .then(
        (infos) => deliver(asList(infos)),
        () => deliver(null),
      )
      .finally(() => {
        if (flying === p) flying = null;
      });
    flying = p;
    return p;
  };
  const later = coalesce(() => void read());

  return {
    /** 듣기 시작한다 — 답이 올 때마다 `fn`. 돌려주는 함수가 그만 듣는다. */
    watch(fn: (answer: TermsAnswer) => void): () => void {
      listeners.add(fn);
      // 구독마다 새 함수 — 앞 구독의 늦은 해제가 같은 함수로 맺은 새 구독을 끊지 않게.
      if (!off) off = terminalApi.onSessionsChanged(() => later.call());
      // 빈 셸의 「도는 중」 은 사건 없이 바뀐다 — 켤 때마다 지금 것을 읽는다. 읽는 중이면 그 답을 같이 받는다.
      if (!flying) void read();
      return () => {
        listeners.delete(fn);
        if (listeners.size > 0) return;
        later.cancel();
        // 아무도 안 듣는 동안 떠 있던 읽기에는 다음에 켠 훅이 얹지 않는다 — 그새 낡았다.
        flying = null;
        const stop = off;
        off = null;
        void stop?.then((unlisten) => unlisten()).catch(() => {});
      };
    },
  };
})();

/**
 * 이 창의 세션 — 처음 한 번 읽고, 어느 창에서든 세션 · 상태가 바뀌면 다시 읽는다(`REFETCH_COALESCE_MS`).
 * 「Claude 에게 보내기」 는 읽기 전 · 실패를 갈라 말해야 해서 상태도 받는다.
 *
 * 꺼지면(`enabled` → false) 읽지 않은 상태로 돌아간다 — 꺼진 동안 목록은 따라가지 않아 낡는다. 남겨 두면 다시
 * 켠 첫 렌더가 지난번 목록을 「읽음」 으로 보여, 보내기 대화상자가 그 낡은 목록으로 받는 곳을 정했다.
 *
 * 읽기는 창에 하나다(`windowTermsHub`) — 훅이 몇이든 사건 한 묶음에 한 번 읽는다. 답이 앞과 같으면 상태를
 * 바꾸지 않는다(같은 배열 그대로): 다른 창의 세션이 낸 사건 · 같은 상태를 다시 알린 사건에 셸과 지금 화면이
 * 다시 그려지지 않는다.
 */
export function useWindowTermsState(enabled = true): WindowTerms {
  const [terms, setTerms] = useState<WindowTerms>(UNREAD);
  useEffect(() => {
    if (!enabled) {
      setTerms(UNREAD);
      return;
    }
    setTerms((t) => (t.state === "loading" ? t : { ...t, state: "loading" }));
    return windowTermsHub.watch((answer) =>
      setTerms((t) => {
        if (answer == null) return t.state === "failed" ? t : { list: t.list, state: "failed" };
        const same = sameJson(t.list, answer);
        if (same && t.state === "ready") return t;
        return { list: same ? t.list : answer, state: "ready" };
      }),
    );
  }, [enabled]);
  return terms;
}

/** 이 창의 세션 — 목록만 (`useWindowTermsState`). */
export function useWindowTerms(enabled = true): TermInfo[] {
  return useWindowTermsState(enabled).list;
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
        .then((infos) => {
          if (!alive) return;
          // 수가 그대로면 앞 표를 둔다 — 프로젝트 목록(윗줄에 늘 서 있다)이 사건마다 다시 그려지지 않게.
          const next = countByProject(asList(infos));
          setCounts((prev) => (sameJson([...prev], [...next]) ? prev : next));
        })
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
