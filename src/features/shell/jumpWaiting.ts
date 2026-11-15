/**
 * 「기다리는 세션으로」 한 키 (⌘J, 11-15) — Claude 가 나를 기다리는 곳으로 곧장. 이름은 「기다림」 계열이다 —
 * 「내 차례」 는 오늘 화면의 계획 사람 몫(누르면 계획으로)이라, 같은 말로 부르면 다른 것을 가리켰다(11-15 검수).
 *
 * 기다리는 세션은 목록의 점 · Dock 배지 · 창 제목으로만 보였고 그 칸으로 가는 키가 없었다. 에이전트 여럿의
 * 차례를 키보드만으로 처리하는 것이 「예외만」과 맞물린다.
 *
 * 차례: 이 창 먼저, 그다음 다른 창.
 *   1. 이 창 세션 가운데 내 손을 기다리는 것(OSC 7501 blocked)을 오래 기다린 순 — 다시 누르면 다음, 끝에서
 *      처음으로. 그다음이 그 창을 안 본 사이 끝난 것(오류 먼저).
 *   2. 이 프로젝트의 질문(ask_user) · 바깥 터미널의 기다림(Notification 훅) — 오늘 화면으로(답 칸 · 「Claude 가
 *      기다려요」 줄이 거기 선다). 예전엔 이것을 못 보고 「기다리는 세션이 없어요」 라고 했는데, 같은 창 오늘
 *      화면에는 「Claude 가 물어요」 가 서 있었다.
 *   3. 다른 창의 기다리는 세션 — 1 과 같은 정의로, 가장 오래 기다린 것의 창을 앞으로.
 *   4. 다른 창의 질문 · 바깥 기다림 — 가장 많은 창을 앞으로. **열린 창만** 본다: 질문은 창이 없는 프로젝트도
 *      디스크에서 세어서, 예전엔 ⌘J 가 새 프로젝트 창을 열었고 그 창에서 다시 누르면 고를 세션이 없어 튀었다.
 * 그것도 없으면 조용한 토스트 한 줄. 세션을 고르는 것은 `requestTermFocus` 하나다 — 셸이 그 요청을 듣고
 * 화면을 터미널로 옮긴다(오늘의 「터미널에서 보기」 · 알림 착지와 같은 길).
 */
import { terminalApi, type TermInfo } from "@/api/terminal";
import { windowApi } from "@/api/window";
import { requestTermFocus } from "@/features/terminal/focusRequest";
import { needsMe } from "@/features/terminal/status";
import { t } from "@/i18n";
import type { ProjectAttention } from "@/lib/bindings";
import { NAV_BUS } from "@/lib/navRegistry";
import { toast } from "@/lib/toast";

/** 그 상태로 바뀐 시각 — 모르면 맨 뒤. */
function sinceMs(s: TermInfo): number {
  const ms = Date.parse(s.status?.since ?? "");
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

const waitingOnMe = (s: TermInfo) => s.alive && needsMe(s.status);
const oldestFirst = (a: TermInfo, b: TermInfo) => sinceMs(a) - sinceMs(b);

/**
 * 그 창을 안 본 사이 끝난 세션 — 안의 프로그램이 끝냄 · 오류를 알렸거나 셸째 끝났다.
 * 지금의 `unseen` 은 창 단위이고 창이 앞에 오면 지워져서, 앞 창에서만 눌리는 ⌘J 에는 대개 거짓이다 — 엔진이
 * 세션 단위 소식을 주면 그대로 듣도록 자리만 둔다.
 */
function endedUnseen(s: TermInfo): boolean {
  if (!s.unseen || needsMe(s.status)) return false;
  return !s.alive || s.status?.state === "done" || s.status?.state === "error";
}

/** 오류로 끝난 것이 앞 — 프로그램이 오류를 알렸거나 셸이 0 이 아닌 코드로 끝났다. */
const errorRank = (s: TermInfo) => (s.status?.state === "error" || (!s.alive && (s.exit_code ?? 0) !== 0) ? 0 : 1);

/** 차례 줄 — 기다림(오래 기다린 순) 다음 끝남(오류 먼저). */
export function waitingOrder(sessions: readonly TermInfo[]): TermInfo[] {
  const blocked = sessions.filter(waitingOnMe).sort(oldestFirst);
  const ended = sessions.filter(endedUnseen).sort((a, b) => errorRank(a) - errorRank(b) || oldestFirst(a, b));
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

export type JumpResult = "session" | "today" | "window" | "none";

/** 목록 명령은 봉투 없이 배열을 준다 — 못 읽거나 배열이 아니면 빈 목록. 키가 예외를 던지면 안 된다. */
async function listOf<T>(read: () => Promise<T[]>): Promise<T[]> {
  const list = await Promise.resolve()
    .then(read)
    .catch((): T[] => []);
  return Array.isArray(list) ? list : [];
}

/** ⌘J 한 번 — 머리 주석의 차례대로 한 곳에 간다. */
export async function jumpToWaiting(currentProjectId: number | null): Promise<JumpResult> {
  const id = nextWaiting(await listOf(() => terminalApi.list()), lastJumped);
  if (id != null) {
    lastJumped = id;
    requestTermFocus(id);
    return "session";
  }
  const open = await listOf(() => windowApi.openProjectIds());
  const others = open.filter((p) => p !== currentProjectId);
  const asked = currentProjectId == null ? others : [currentProjectId, ...others];
  const attention = asked.length
    ? await Promise.resolve()
        .then(() => windowApi.attention(asked))
        .catch(() => new Map<number, ProjectAttention>())
    : new Map<number, ProjectAttention>();
  if (currentProjectId != null && (attention.get(currentProjectId)?.waiting ?? 0) > 0) {
    window.dispatchEvent(new CustomEvent(NAV_BUS.setView, { detail: "today" }));
    return "today";
  }
  const elsewhere = (await listOf(() => terminalApi.overview()))
    .filter((s) => s.project_id !== currentProjectId && waitingOnMe(s))
    .sort(oldestFirst)[0];
  let target = elsewhere?.project_id ?? null;
  if (target == null) {
    let most = 0;
    for (const p of others) {
      const n = attention.get(p)?.waiting ?? 0;
      if (n > most) {
        most = n;
        target = p;
      }
    }
  }
  if (target != null) {
    await windowApi.openProjectWindow(target).catch(() => {});
    return "window";
  }
  toast.info(t("nav.jumpWaitingNone"), { dedupKey: "jump-waiting-none", dedupWindowMs: 4000 });
  return "none";
}
