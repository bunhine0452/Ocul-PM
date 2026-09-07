import { useEffect, useMemo, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { seatActivity, type SeatActivity } from "@/features/sessions/sessionActivity";
import { buildBoard, type SessionSeat } from "@/features/sessions/sessionModel";
import type { A2aOverview } from "@/lib/bindings";
import { safeUnlisten, type MaybeAsyncUnlisten } from "@/lib/unlisten";

/**
 * Today 의 「지금 무엇을 하고 있는가」 자료 (플랜 `v3-release`
 * `{#today-activity-row}`).
 *
 * Today 가 지금까지 활동에 대해 할 수 있는 말은 **집계뿐이었다** — 「활동 시간
 * 2시간 14분」. 그건 지난 일의 합이지 지금이 아니다. 지금을 아는 자리는 이미
 * 있다(세션 화면), 다만 Today 에서 그 화면까지 가야 보였다.
 *
 * **어휘를 새로 만들지 않는다.** 세션 카드가 쓰는 `seatActivity()` 와 대화
 * 화면의 `ActivityLine` 을 그대로 부른다 — 같은 일을 두 화면이 다른 낱말로
 * 부르면 오갈 때마다 사용자가 번역을 한 번씩 한다 (`{#activity-vocab-reuse}`).
 * 이름표(`buildBoard` 의 별명 겹치기)까지 같은 것을 쓰는 이유도 같다.
 *
 * 폴링하지 않는다 — 원장은 앱 밖 프로세스가 쓰고 워처가 알린다
 * (`sessionAttention.ts` 와 같은 규약).
 */
export interface TodayActivityRow {
  seat: SessionSeat;
  /** 원장이 아는 것이 없으면 null — 조용한 것과 모르는 것은 여기서 같다. */
  activity: SeatActivity | null;
}

export interface TodayActivityState {
  /**
   * 원장을 한 번이라도 읽었는가. **모르는 것과 없는 것은 다르다** — 읽기 전에
   * 「붙어 있는 세션이 없어요」를 적으면 그건 추측이다.
   */
  loaded: boolean;
  rows: TodayActivityRow[];
}

const NO_ALIASES: Record<string, string> = {};

export function useTodayActivity(projectId: number, enabled: boolean): TodayActivityState {
  const ws = useOptionalWorkspace();
  const aliases = ws?.state.sessionAliases ?? NO_ALIASES;
  const [overview, setOverview] = useState<A2aOverview | null>(null);

  useEffect(() => {
    if (!enabled) {
      setOverview(null);
      return;
    }
    let alive = true;
    const reload = () => {
      void oculpmApi
        .a2aOverview(projectId)
        .then((data) => {
          if (alive) setOverview(data);
        })
        // 원장을 못 읽는 것은 이 카드가 말할 일이 아니다 — 세션 화면이 사유를
        // 세운다. 여기서는 「모른다」로 되돌아가 카드가 조용히 빠진다.
        .catch(() => {
          if (alive) setOverview(null);
        });
    };
    reload();
    // 구독이 붙기 전에 언마운트될 수 있다 (화면을 스쳐 지나가거나 StrictMode).
    // `alive` 가 없으면 뒤늦게 resolve 한 리스너가 영영 남는다.
    let off: MaybeAsyncUnlisten | null = null;
    void oculpmApi
      .onA2aChanged((payload) => {
        if (payload.project_id === projectId) reload();
      })
      .then((stop) => {
        if (alive) off = stop;
        else safeUnlisten(stop);
      });
    return () => {
      alive = false;
      safeUnlisten(off);
    };
  }, [projectId, enabled]);

  return useMemo(() => {
    if (!overview) return { loaded: false, rows: [] };
    const board = buildBoard(overview, aliases);
    // 팀 먼저, 그다음 묶이지 않은 세션 (세션 화면과 같은 차례 — 묶이지 않은
    // 쪽은 `buildBoard` 가 이미 마지막 활동 순으로 세워 준다).
    const seats = [...board.teams.flatMap((team) => team.members), ...board.unbound];
    return {
      loaded: true,
      rows: seats.map((seat) => ({ seat, activity: seatActivity(seat) })),
    };
  }, [overview, aliases]);
}
