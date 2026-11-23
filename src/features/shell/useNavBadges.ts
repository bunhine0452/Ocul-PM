/**
 * 윗줄 탭 옆의 수 — 「예외만 보여 준다」(4.0).
 *
 * **먼저 볼 것**뿐이다(오늘·변경 탭). 작업 일지 탭의 「오늘 기록 수」(조용한 색)는
 * 걷었다 — 예외가 아닌 수가 예외 옆에 서면 어느 것이 볼 것인지 흐려진다(4.0 「더 단순하게」).
 * 변경 탭의 수는 「오늘 에이전트가 고치고 일지에 안 적은 파일 수」(`compare_workday` 의 미기록)다. 오늘 행은 오늘 화면의 예외 목록 길이를
 * `todayToCheck` 로 받는다(`useTodayExceptions(...).count`) — 안 주면(`undefined`)
 * 미기록 파일 수로 대신한다. `null` 은 「모름」이라 배지가 없다.
 *
 * 11-15: 수의 색은 **가장 심한 행**을 따른다 — 확인 실패 · 막힘이 하나라도 있으면 빨강(danger), 아니면 앰버.
 * 실패와 기다림이 한 앰버 숫자로 합쳐져 실패가 묻혔다. 플러그인 새 판 같은 중립 행은 수에서 뺀다 — 오늘 카드 머리의
 * 「먼저 볼 것 N」 도 같은 규칙(`countedExceptions`)으로 세서 풀이도 같은 이름이다: 「먼저 볼 것 5 · 실패 1」(11-23).
 * 이 창의 터미널 세션이 내 손을 기다리면 터미널 탭에 앰버 점.
 *
 * 워처 이벤트(파일 변경·새 일지)를 1초로 묶어 다시 센다. 못 읽은 칸은 `null` =
 * 배지 없음(0 과 다르다).
 */
import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { projectsApi } from "@/api/projects";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { countedExceptions } from "@/features/today/todayModel";
import { t } from "@/i18n";

export interface NavBadge {
  /** 수 — 0 이면 수가 서지 않는다(점만 설 수 있다). */
  n: number;
  /** 가장 심한 행의 색 — 없으면 앰버. */
  tone?: "warn" | "danger";
  /** 수의 풀이 — 「먼저 볼 것 5 · 실패 1」. */
  title?: string;
  /** 터미널 탭 — 이 창의 세션이 내 손을 기다린다. */
  dot?: boolean;
}

export type NavBadges = Partial<Record<UiV2View, NavBadge>>;

export interface BadgeExtra {
  /** 오늘 화면의 「먼저 볼 것」 행 — 주면 수 · 색 · 풀이를 여기서 센다. */
  todayRows?: readonly { kind: string }[] | null;
  /** 이 창의 터미널 세션이 내 손을 기다린다. */
  termWaiting?: boolean;
}

/** 빨강으로 세는 행 — 확인 명령 실패 · 막힌 항목. */
const DANGER_KINDS = new Set(["verdict", "blocked"]);

const SETTLE_MS = 1000;

export function useNavBadges(
  projectId: number | null,
  workday: string | null,
  ready: boolean,
  todayToCheck?: number | null,
  extra: BadgeExtra = {},
): NavBadges {
  const [unrecorded, setUnrecorded] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (projectId == null || !ready) return;
    let timer: number | null = null;
    const bump = (pid: number) => {
      if (pid !== projectId) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setTick((n) => n + 1), SETTLE_MS);
    };
    const offs = [
      oculpmApi.onFileChanged((p) => bump(p.project_id)),
      projectsApi.onJournalAdded(bump),
    ];
    return () => {
      if (timer != null) window.clearTimeout(timer);
      for (const off of offs) void off.then((fn) => fn());
    };
  }, [projectId, ready]);

  useEffect(() => {
    if (projectId == null || !workday || !ready) {
      setUnrecorded(null);
      return;
    }
    let alive = true;
    void Promise.resolve()
      .then(() => oculpmApi.compareWorkday(projectId, workday))
      .then((c) => new Set(c.sessions.flatMap((s) => s.unrecorded)).size)
      .catch(() => null)
      .then((n) => {
        if (alive) setUnrecorded(n);
      });
    return () => {
      alive = false;
    };
  }, [projectId, workday, ready, tick]);

  return navBadgesOf(unrecorded, todayToCheck, extra);
}

/** 수 → 배지. 0 과 「모름」(`null`)은 배지가 없다 — 예외만 보여 준다. */
export function navBadgesOf(unrecorded: number | null, todayToCheck?: number | null, extra: BadgeExtra = {}): NavBadges {
  const badges: NavBadges = {};
  if (extra.todayRows) {
    const counted = countedExceptions(extra.todayRows);
    const failed = counted.filter((r) => DANGER_KINDS.has(r.kind)).length;
    const n = counted.length;
    if (n) {
      badges.today = {
        n,
        tone: failed ? "danger" : "warn",
        title: failed ? t("nav.badgeTitleFail", { n, m: failed }) : t("nav.badgeTitle", { n }),
      };
    }
  } else {
    const today = todayToCheck === undefined ? unrecorded : todayToCheck;
    if (today) badges.today = { n: today };
  }
  if (unrecorded) badges.diff = { n: unrecorded };
  if (extra.termWaiting) badges.terminal = { n: 0, dot: true };
  return badges;
}
