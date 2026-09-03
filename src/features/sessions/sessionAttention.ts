import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";

/**
 * 사이드바 「세션」 항목의 **승인 대기** 배지 (docs/a2a/00-master-plan.md D8).
 *
 * 묶기가 Today 에서 나가면서 넘어온 작업의 승인 카드도 함께 나갔다. 그 자체는
 * 옳다 — 협업 상태는 한 자리에 모여 있어야 한다. 다만 승인은 **기다린다고 안
 * 풀리고 사람이 눌러야 풀리는 일**이라, 화면을 안 열면 영영 안 보이면 안 된다.
 *
 * 그래서 Claude Code·Codex 항목이 이미 쓰는 그 배지를 그대로 쓴다. 배지는
 * "가 봐야 한다"만 말하고 무엇을 하라고는 말하지 않는다 — 승인은 여전히 화면
 * 안에서 사람이 누른다(D5).
 *
 * 폴링하지 않는다. 원장이 바뀌면 워처가 알려 주고, 그때만 다시 센다.
 */
export function useSessionAttention(projectId: number | null): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (projectId == null) {
      setCount(0);
      return;
    }
    let alive = true;
    const recount = () => {
      void oculpmApi
        .a2aOverview(projectId)
        .then((data) => {
          if (!alive) return;
          setCount(data.open_tasks.filter((task) => task.state === "submitted").length);
        })
        // 원장을 못 읽는 것은 배지가 말할 일이 아니다 — 화면이 사유를 세운다.
        .catch(() => {
          if (alive) setCount(0);
        });
    };
    recount();
    let off: (() => void) | undefined;
    void oculpmApi
      .onA2aChanged((payload) => {
        if (payload.project_id === projectId) recount();
      })
      .then((stop) => {
        if (alive) off = stop;
        else stop();
      });
    return () => {
      alive = false;
      off?.();
    };
  }, [projectId]);

  return count;
}
