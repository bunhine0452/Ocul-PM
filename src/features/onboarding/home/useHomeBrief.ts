/**
 * 메인 화면 데이터 훅 — `home_brief` 1콜.
 *
 * 설계 규칙 3가지:
 *  1. **실패해도 화면이 선다.** 백엔드가 없거나(구버전) 실패하면 `brief=null`
 *     로 두고 `failed` 만 켠다. throw 하지 않는다 — 프로젝트 목록은 이미
 *     App 이 갖고 있으므로 이름·경로만으로도 화면은 완전히 동작한다.
 *  2. **stale-while-revalidate.** 재조회 중에 스켈레톤으로 되돌리지 않는다.
 *     창을 왔다 갔다 할 때마다 화면이 깜빡이면 그게 더 나쁘다.
 *  3. **동기 throw 도 처리된 rejection 으로.** `Promise.resolve().then(...)`
 *     로 감싸 얇은 테스트 mock 이나 커맨드 부재에서도 unhandled rejection 이
 *     생기지 않게 한다 (기존 StartScreen 의 방어 규약 계승).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { commands, type HomeBrief, type Project } from "@/lib/bindings";
import { SPARK_DAYS } from "./homeModel";

/** 창 전환마다 IPC 를 때리지 않도록 하는 최소 간격. */
const REFETCH_THROTTLE_MS = 15_000;

export interface UseHomeBrief {
  brief: HomeBrief | null;
  /** 첫 로드 중 (재조회 중에는 false — 화면을 깜빡이지 않는다). */
  loading: boolean;
  /** 마지막 시도가 실패했는가. 에러 배너가 아니라 조용한 각주로 쓴다. */
  failed: boolean;
  reload: () => void;
}

export function useHomeBrief(projects: Project[]): UseHomeBrief {
  const [brief, setBrief] = useState<HomeBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const alive = useRef(true);
  const lastFetch = useRef(0);
  /** 재조회가 겹칠 때 늦게 도착한 응답이 최신을 덮지 않도록. */
  const seq = useRef(0);

  const fetch = useCallback(async () => {
    const mine = ++seq.current;
    lastFetch.current = Date.now();
    try {
      const res = await Promise.resolve().then(() => commands.homeBrief(SPARK_DAYS));
      if (!alive.current || mine !== seq.current) return;
      if (res && res.status === "ok") {
        setBrief(res.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      // 커맨드 자체가 없는 구버전 백엔드도 여기로 온다 — 조용히 폴백.
      if (alive.current && mine === seq.current) setFailed(true);
    } finally {
      if (alive.current && mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 프로젝트 목록이 바뀌면(추가/삭제/이름변경) 다시 집계한다.
  useEffect(() => {
    void fetch();
  }, [fetch, projects]);

  // 창으로 돌아오면 갱신 — 사용자가 다른 앱에서 에이전트를 돌리다 왔을 수 있다.
  // 워처가 없는 화면이라(프로젝트 미선택) 이게 유일한 신선도 경로다.
  useEffect(() => {
    function maybeRefetch() {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastFetch.current < REFETCH_THROTTLE_MS) return;
      void fetch();
    }
    window.addEventListener("focus", maybeRefetch);
    document.addEventListener("visibilitychange", maybeRefetch);
    return () => {
      window.removeEventListener("focus", maybeRefetch);
      document.removeEventListener("visibilitychange", maybeRefetch);
    };
  }, [fetch]);

  const reload = useCallback(() => {
    void fetch();
  }, [fetch]);

  return { brief, loading, failed, reload };
}
