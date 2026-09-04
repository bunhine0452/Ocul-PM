import { useCallback, useEffect, useMemo, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { safeUnlisten, type MaybeAsyncUnlisten } from "@/lib/unlisten";
import { toAppError } from "@/api/invoke";
import { tError } from "@/i18n/errors";
import { useMinuteTick } from "@/hooks/useSecondTick";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { A2aOverview } from "@/lib/bindings";
import { buildBoard, withMembers, type BoardModel } from "./sessionModel";

/**
 * 침범 경고 한 건 — 이벤트로만 오고 원장에는 남지 않는다.
 *
 * 그래서 **언제 왔는지를 우리가 적는다.** 원장에 없다는 것은 해소됐다는 신호도
 * 원장이 주지 않는다는 뜻이라, 시각이 없으면 이 줄은 화면이 살아 있는 내내
 * 남는다 (→ `TRESPASS_TTL_MS`).
 */
export interface Trespass {
  actor: string;
  path: string;
  holder: string;
  /** 이벤트가 도착한 시각 (`Date.now()`). */
  at: number;
}

/**
 * 침범 경고가 「급한 것」 자리에 머무는 시간.
 *
 * 이 화면은 이번에 **목적지**가 되면서 마운트가 몇 시간씩 유지된다. 그동안
 * 임대가 만료되거나 주인이 놓아 충돌이 끝나도, 지우는 길이 없으면 사용자는
 * 이미 끝난 싸움을 계속 본다. 침범은 상태가 아니라 **사건**이므로 "최근 것"
 * 으로만 보여주는 것이 정직하다 — 해소를 알려 주는 신호가 없기 때문에
 * 해소를 추측하는 대신 시간을 재는 쪽을 택했다.
 */
const TRESPASS_TTL_MS = 10 * 60_000;

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
    // 구독이 **붙기 전에** 언마운트될 수 있다 (화면을 스쳐 지나가거나, dev
    // StrictMode 의 mount→cleanup→mount). 그때 `alive` 가 없으면 cleanup 이
    // 빈 손으로 돌고, 뒤늦게 resolve 한 리스너가 영영 남아 원장이 바뀔 때마다
    // 죽은 훅의 `reload()` 를 돌린다 — 드나든 횟수만큼 IPC 가 겹친다.
    // 같은 경쟁을 `sessionAttention.ts` 와 `JournalMissingCard.tsx` 가 이미
    // 이렇게 막고 있다.
    let alive = true;
    let offChanged: MaybeAsyncUnlisten | null = null;
    let offTrespass: MaybeAsyncUnlisten | null = null;
    void oculpmApi
      .onA2aChanged((payload) => {
        if (payload.project_id === projectId) reload();
      })
      .then((off) => {
        if (alive) offChanged = off;
        else safeUnlisten(off);
      });
    void oculpmApi
      .onA2aTrespass(({ project_id, actor, path, holder }) => {
        if (project_id !== projectId) return;
        setTrespasses((prev) =>
          prev.some((p) => p.path === path && p.actor === actor)
            ? prev
            : [...prev, { actor, path, holder, at: Date.now() }],
        );
      })
      .then((off) => {
        if (alive) offTrespass = off;
        else safeUnlisten(off);
      });
    return () => {
      alive = false;
      // 해제 함수는 실제로 async 라 리로드 시점에 reject 할 수 있다 — 그걸
      // 삼키는 것이 `safeUnlisten` 의 일이다 (`lib/unlisten.ts` 주석).
      safeUnlisten(offChanged);
      safeUnlisten(offTrespass);
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

  // 분 시계가 이미 돌고 있으므로(상대 시각 표시용) 낡은 경고는 그 리듬에
  // 얹어 저절로 빠진다 — 지우는 타이머를 따로 두지 않는다.
  const freshTrespasses = useMemo(
    () => trespasses.filter((hit) => now - hit.at < TRESPASS_TTL_MS),
    [trespasses, now],
  );

  return {
    data,
    board,
    error,
    trespasses: freshTrespasses,
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
