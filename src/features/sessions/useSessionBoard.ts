import { useCallback, useEffect, useMemo, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { toAppError } from "@/api/invoke";
import { tError } from "@/i18n/errors";
import { useMinuteTick } from "@/hooks/useSecondTick";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { A2aOverview } from "@/lib/bindings";
import { buildBoard, withMembers, type BoardModel } from "./sessionModel";

/** 침범 경고 한 건 — 이벤트로만 오고 원장에는 남지 않는다. */
export interface Trespass {
  actor: string;
  path: string;
  holder: string;
}

export interface SessionBoard {
  data: A2aOverview | null;
  board: BoardModel | null;
  error: string | null;
  trespasses: Trespass[];
  /** 상대 시각을 살아 있게 하는 분 시계. */
  now: number;
  reload: () => void;
  /** 성공했는가 — 실패했으면 화면이 고른 것을 **버리지 않는다.** */
  bind: (title: string, members: string[]) => Promise<boolean>;
  addToTeam: (groupId: string, members: string[]) => Promise<boolean>;
  removeMember: (groupId: string, memberId: string) => Promise<boolean>;
  dissolve: (groupId: string) => Promise<boolean>;
  decide: (taskId: string, accept: boolean) => Promise<boolean>;
  release: (leaseId: string) => Promise<boolean>;
  setAlias: (agentId: string, alias: string) => void;
}

/**
 * 세션 보드의 데이터 한 벌 (docs/a2a/00-master-plan.md D8).
 *
 * **폴링하지 않는다.** 원장은 앱 밖 프로세스가 쓰고 워처가 그것을 알린다 —
 * Today 카드가 쓰던 그 규약 그대로다. 화면이 목적지가 되면서 머무는 시간이
 * 길어졌으니 폴링은 더더욱 안 된다.
 */
export function useSessionBoard(projectId: number): SessionBoard {
  const { state, setState } = useWorkspace();
  const [data, setData] = useState<A2aOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trespasses, setTrespasses] = useState<Trespass[]>([]);
  const now = useMinuteTick(true);

  const reload = useCallback(() => {
    void oculpmApi
      .a2aOverview(projectId)
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((e: unknown) => setError(tError(toAppError(e))));
  }, [projectId]);

  useEffect(() => {
    reload();
    let offChanged: (() => void) | undefined;
    let offTrespass: (() => void) | undefined;
    void oculpmApi
      .onA2aChanged((payload) => {
        if (payload.project_id === projectId) reload();
      })
      .then((off) => {
        offChanged = off;
      });
    void oculpmApi
      .onA2aTrespass(({ project_id, actor, path, holder }) => {
        if (project_id !== projectId) return;
        setTrespasses((prev) =>
          prev.some((p) => p.path === path && p.actor === actor)
            ? prev
            : [...prev, { actor, path, holder }],
        );
      })
      .then((off) => {
        offTrespass = off;
      });
    return () => {
      offChanged?.();
      offTrespass?.();
    };
  }, [projectId, reload]);

  const aliases = state.sessionAliases;
  const board = useMemo(() => (data ? buildBoard(data, aliases) : null), [data, aliases]);

  /**
   * 쓰기 한 번 — 실패하면 사유를 세우고 **성공 여부를 돌려준다.**
   *
   * 부르는 쪽이 그걸 봐야 하는 이유: 묶기가 거절됐는데 화면이 고른 세션을
   * 지워 버리면, 사용자는 오류 문장 하나를 읽고 넷 중 둘을 처음부터 다시
   * 골라야 한다.
   */
  const run = useCallback(
    async (job: () => Promise<unknown>) => {
      let ok = true;
      try {
        await job();
        setError(null);
      } catch (e) {
        ok = false;
        setError(tError(toAppError(e)));
      }
      // 성공이든 실패든 다시 읽는다 — 실패의 절반은 "그 사이 원장이 바뀐 것"
      // 이고, 그때 화면이 옛 상태로 남아 있으면 사용자가 같은 실패를 반복한다.
      reload();
      return ok;
    },
    [reload],
  );

  const bind = useCallback(
    (title: string, members: string[]) =>
      run(() => oculpmApi.a2aBindGroup(projectId, title, members)),
    [projectId, run],
  );

  const addToTeam = useCallback(
    (groupId: string, members: string[]) =>
      run(async () => {
        const group = data?.groups.find((g) => g.id === groupId);
        if (!group) return;
        const next = withMembers(group.members, members);
        if (next.length === group.members.length) return;
        await oculpmApi.a2aSetGroupMembers(projectId, groupId, next);
      }),
    [data, projectId, run],
  );

  /**
   * 멤버 하나를 뺀다. 둘짜리에서 빼는 것은 **해체**이므로 그쪽으로 보낸다 —
   * 백엔드가 둘 미만을 거절하기 때문이고, 사용자에게는 같은 뜻이기 때문이다.
   */
  const removeMember = useCallback(
    (groupId: string, memberId: string) =>
      run(async () => {
        const group = data?.groups.find((g) => g.id === groupId);
        if (!group) return;
        const next = group.members.filter((m) => m !== memberId);
        if (next.length < 2) {
          await oculpmApi.a2aDissolveGroup(projectId, groupId);
          return;
        }
        await oculpmApi.a2aSetGroupMembers(projectId, groupId, next);
      }),
    [data, projectId, run],
  );

  const dissolve = useCallback(
    (groupId: string) => run(() => oculpmApi.a2aDissolveGroup(projectId, groupId)),
    [projectId, run],
  );

  const decide = useCallback(
    (taskId: string, accept: boolean) =>
      run(() => oculpmApi.a2aDecideTask(projectId, taskId, accept)),
    [projectId, run],
  );

  const release = useCallback(
    (leaseId: string) => run(() => oculpmApi.a2aReleaseLease(projectId, leaseId)),
    [projectId, run],
  );

  /**
   * 별명은 **디스크 원장이 아니라 이 컴퓨터의 워크스페이스**에 산다.
   *
   * 빈 문자열은 지우기다 — 빈 값을 남겨 두면 다음 세션에서 "별명이 있는데
   * 안 보인다" 가 된다.
   */
  const setAlias = useCallback(
    (agentId: string, alias: string) => {
      const trimmed = alias.trim();
      setState((prev) => {
        const next = { ...prev.sessionAliases };
        if (trimmed) next[agentId] = trimmed;
        else delete next[agentId];
        return { ...prev, sessionAliases: next };
      });
    },
    [setState],
  );

  return {
    data,
    board,
    error,
    trespasses,
    now,
    reload,
    bind,
    addToTeam,
    removeMember,
    dissolve,
    decide,
    release,
    setAlias,
  };
}
