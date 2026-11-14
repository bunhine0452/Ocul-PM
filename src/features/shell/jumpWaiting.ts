/**
 * 「내 차례」 한 키 (⌘J, 11-15) — 기다리는 세션으로 곧장.
 *
 * 기다리는 세션은 목록의 점 · Dock 배지 · 창 제목으로만 보였고 그 칸으로 가는 키가 없었다. 에이전트 여럿의
 * 차례를 키보드만으로 처리하는 것이 「예외만」과 맞물린다.
 *
 * 차례 줄: 이 창 세션 가운데 내 손을 기다리는 것(blocked)을 오래 기다린 순, 다음이 그 창을 안 본 사이
 * 끝난 것(오류 먼저). 다시 누르면 다음, 끝에서 처음으로. 이 창에 없으면 기다리는 다른 프로젝트 창을 앞으로,
 * 그것도 없으면 조용한 토스트 한 줄. 세션을 고르는 것은 `requestTermFocus` 하나다 — 셸이 그 요청을 듣고
 * 화면을 터미널로 옮긴다(오늘의 「터미널에서 보기」 · 알림 착지와 같은 길).
 */
import { terminalApi, type TermInfo } from "@/api/terminal";
import { windowApi } from "@/api/window";
import { requestTermFocus } from "@/features/terminal/focusRequest";
import { needsMe } from "@/features/terminal/status";
import { t } from "@/i18n";
import { toast } from "@/lib/toast";

/** 그 상태로 바뀐 시각 — 모르면 맨 뒤. */
function sinceMs(s: TermInfo): number {
  const ms = Date.parse(s.status?.since ?? "");
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** 그 창을 안 본 사이 끝난 세션 — 안의 프로그램이 끝냄 · 오류를 알렸거나 셸째 끝났다. */
function endedUnseen(s: TermInfo): boolean {
  if (!s.unseen || needsMe(s.status)) return false;
  return !s.alive || s.status?.state === "done" || s.status?.state === "error";
}

/** 오류로 끝난 것이 앞 — 프로그램이 오류를 알렸거나 셸이 0 이 아닌 코드로 끝났다. */
const errorRank = (s: TermInfo) => (s.status?.state === "error" || (!s.alive && (s.exit_code ?? 0) !== 0) ? 0 : 1);

/** 차례 줄 — 기다림(오래 기다린 순) 다음 끝남(오류 먼저). */
export function waitingOrder(sessions: readonly TermInfo[]): TermInfo[] {
  const blocked = sessions.filter((s) => s.alive && needsMe(s.status)).sort((a, b) => sinceMs(a) - sinceMs(b));
  const ended = sessions.filter(endedUnseen).sort((a, b) => errorRank(a) - errorRank(b) || sinceMs(a) - sinceMs(b));
  return [...blocked, ...ended];
}

/** 다음에 갈 세션 — `lastId` 가 차례 줄에 있으면 그다음(끝이면 처음), 없으면 맨 앞. 갈 데가 없으면 `null`. */
export function nextWaiting(sessions: readonly TermInfo[], lastId: number | null): number | null {
  const order = waitingOrder(sessions);
  if (order.length === 0) return null;
  const at = lastId == null ? -1 : order.findIndex((s) => s.id === lastId);
  return order[(at + 1) % order.length].id;
}

/** 직전에 간 세션 — 창 하나가 웹뷰 하나라 모듈 값이 곧 창의 값이다. */
let lastJumped: number | null = null;

/** 시험 전용 — 창 하나의 수명을 흉내 낸다. */
export function __resetJumpForTests(): void {
  lastJumped = null;
}

export type JumpResult = "session" | "window" | "none";

/**
 * ⌘J 한 번. 이 창의 차례 줄에서 다음 세션을 고르고, 없으면 기다리는 다른 프로젝트 창(기다림이 가장 많은 것)을
 * 앞으로, 그것도 없으면 토스트. 목록을 못 읽으면 빈 목록으로 접는다 — 키가 예외를 던지면 안 된다.
 */
export async function jumpToWaiting(currentProjectId: number | null, projectIds: readonly number[]): Promise<JumpResult> {
  const mine = await Promise.resolve()
    .then(() => terminalApi.list())
    .catch((): TermInfo[] => []);
  const id = nextWaiting(Array.isArray(mine) ? mine : [], lastJumped);
  if (id != null) {
    lastJumped = id;
    requestTermFocus(id);
    return "session";
  }
  const others = projectIds.filter((p) => p !== currentProjectId);
  if (others.length > 0) {
    const attention = await Promise.resolve()
      .then(() => windowApi.attention(others))
      .catch(() => new Map<number, { waiting: number }>());
    let target: number | null = null;
    let most = 0;
    for (const p of others) {
      const n = attention.get(p)?.waiting ?? 0;
      if (n > most) {
        most = n;
        target = p;
      }
    }
    if (target != null) {
      await windowApi.openProjectWindow(target).catch(() => {});
      return "window";
    }
  }
  toast.info(t("nav.jumpWaitingNone"), { dedupKey: "jump-waiting-none", dedupWindowMs: 4000 });
  return "none";
}
