// 코드 화면 ↔ 디버그 세션. 백엔드가 프로세스·프로토콜·상태 기계를 다 맡으므로
// 여기서는 **이벤트 구독**과 **멈춘 순간의 조회**만 한다 (useLsp 와 같은 태도).
//
// 폴링하지 않는다: 상태는 `DapSessionChanged` 로 밀려 오고, 스택·변수는 그
// 상태가 `stopped` 로 바뀐 순간에만 한 번 묻는다. 디버거는 대부분의 시간을
// 멈춰 있거나 돌고 있고, 그 사이에 물을 것이 없다.
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DapBreakpoint,
  DapFrame,
  DapLaunchRequest,
  DapOutput,
  DapSessionInfo,
  DapVariable,
} from "@/lib/bindings";
import { dapApi, type DapControlAction } from "@/api/dap";
import { errorDetail } from "@/api/invoke";
import { safeUnlisten } from "@/lib/unlisten";
import { oculpmLog } from "@/lib/oculpmLog";
import { remapPathKeys } from "./fileOps";

/** 콘솔에 쌓아 두는 최대 줄 수 — 무한정 자라면 멈춘 순간 앱이 굳는다. */
const OUTPUT_CAP = 500;

export interface UseDebugResult {
  session: DapSessionInfo | null;
  /** 멈춰 있을 때의 호출 스택. 아니면 빈 배열. */
  frames: DapFrame[];
  /** 사용자가 고른 프레임 — 변수 트리의 뿌리. */
  selectedFrameId: number | null;
  selectFrame: (frameId: number) => void;
  /** 디버기의 표준 출력·오류. */
  output: DapOutput[];
  clearOutput: () => void;
  /** 파일별 중단점 (1-based). */
  breakpointsFor: (path: string) => number[];
  /** 어댑터가 못 건다고 답한 줄 (파일별). */
  unverifiedFor: (path: string) => number[];
  toggleBreakpoint: (path: string, line: number) => void;
  /** 파일·폴더 이름이 바뀌었다 — 중단점이 새 경로를 따라간다 (저장소는 `code_rename` 이 옮긴다). */
  renamePath: (from: string, to: string, isDir: boolean) => void;
  start: (request: DapLaunchRequest) => Promise<string | null>;
  stop: () => void;
  control: (action: DapControlAction) => void;
  /** 변수 한 겹 — 트리가 펼칠 때마다 부른다. */
  variables: (reference: number) => Promise<DapVariable[]>;
  /** 최상위 스코프의 변수 (선택 프레임 기준). */
  scopeRoots: { name: string; reference: number; expensive: boolean }[];
}

export function useDebug(projectId: number): UseDebugResult {
  const [session, setSession] = useState<DapSessionInfo | null>(null);
  const [frames, setFrames] = useState<DapFrame[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);
  const [scopeRoots, setScopeRoots] = useState<UseDebugResult["scopeRoots"]>([]);
  const [output, setOutput] = useState<DapOutput[]>([]);
  const [breakpoints, setBreakpoints] = useState<Map<string, number[]>>(() => new Map());
  const [unverified, setUnverified] = useState<Map<string, number[]>>(() => new Map());

  const sessionRef = useRef(session);
  sessionRef.current = session;

  // ── 초기 상태 ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    dapApi.session(projectId).then(
      (current) => {
        if (!cancelled) setSession(current);
      },
      () => {},
    );
    dapApi.allBreakpoints(projectId).then(
      (files) => {
        // 배열 가드 — 비-Tauri 환경(테스트 목)은 알 수 없는 커맨드에 null 을 준다.
        if (cancelled || !Array.isArray(files)) return;
        setBreakpoints(new Map(files.map((f) => [f.path, f.lines])));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── 이벤트 구독 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const offs: Array<() => void> = [];
    let active = true;
    const keep = (off: () => void) => (active ? offs.push(off) : safeUnlisten(off));
    // jsdom / 비-Tauri 에서는 래퍼가 빈 해제 함수를 준다 — 라이브 갱신만 없다.
    void dapApi
      .onSessionChanged((payload) => {
        if (payload.project_id !== projectId) return;
        setSession(payload.session);
      })
      .then(keep);
    void dapApi
      .onOutput((payload) => {
        if (payload.project_id !== projectId) return;
        setOutput((prev) => {
          const next = [...prev, payload.output];
          return next.length > OUTPUT_CAP ? next.slice(next.length - OUTPUT_CAP) : next;
        });
      })
      .then(keep);
    void dapApi
      .onBreakpointsChanged((payload) => {
        if (payload.project_id !== projectId) return;
        applyConfirmed(payload.breakpoints, setBreakpoints, setUnverified);
      })
      .then(keep);
    return () => {
      active = false;
      offs.forEach(safeUnlisten);
    };
  }, [projectId]);

  // ── 멈춘 순간에만 스택을 묻는다 ─────────────────────────────────────────
  const stoppedKey = session?.state === "stopped" ? `${session.thread_id}:${session.stopped_reason}` : null;
  useEffect(() => {
    if (stoppedKey == null) {
      setFrames([]);
      setSelectedFrameId(null);
      setScopeRoots([]);
      return;
    }
    let cancelled = false;
    dapApi.stack(projectId).then(
      (stack) => {
        if (cancelled) return;
        setFrames(stack);
        // 멈추면 **맨 위 프레임**을 자동으로 고른다 — 사용자가 매번 누르게 하면
        // 스텝마다 손이 한 번씩 더 간다.
        setSelectedFrameId(stack[0]?.id ?? null);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [stoppedKey, projectId]);

  // 고른 프레임의 스코프.
  useEffect(() => {
    if (selectedFrameId == null) {
      setScopeRoots([]);
      return;
    }
    let cancelled = false;
    dapApi.scopes(projectId, selectedFrameId).then(
      (scopes) => {
        if (cancelled) return;
        setScopeRoots(
          scopes.map((s) => ({
          name: s.name,
          // specta 는 `f64` 를 `number | null` 로 내보낸다 (NaN·Infinity 가
          // JSON 에 없어서). 우리 값은 정수를 캐스팅한 것이라 null 이 될 수
          // 없지만, 타입을 좁혀 두어야 아래 전부가 깨끗해진다.
          reference: s.variables_reference ?? 0,
          expensive: s.expensive,
          })),
        );
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [selectedFrameId, projectId]);

  // ── 조작 ────────────────────────────────────────────────────────────────
  const toggleBreakpoint = useCallback(
    (path: string, line: number) => {
      dapApi.toggleBreakpoint(projectId, path, line).then(
        (lines) => {
          setBreakpoints((prev) => new Map(prev).set(path, lines));
          // 껐다 켠 줄의 "못 건다" 표시는 확정 응답이 다시 정한다.
          setUnverified((prev) => {
            const kept = (prev.get(path) ?? []).filter((l) => lines.includes(l));
            return new Map(prev).set(path, kept);
          });
        },
        (e: unknown) => oculpmLog.error("dap", `toggleBreakpoint failed: ${errorDetail(e)}`, { path, line }),
      );
    },
    [projectId],
  );

  const start = useCallback(
    async (request: DapLaunchRequest) => {
      let started: DapSessionInfo;
      try {
        started = await dapApi.start(projectId, request);
      } catch (e) {
        return errorDetail(e);
      }
      setSession(started);
      setOutput([]);
      return null;
    },
    [projectId],
  );

  const stop = useCallback(() => {
    void dapApi
      .stop(projectId)
      .catch(() => null)
      .then(() => setSession(null));
  }, [projectId]);

  const control = useCallback(
    (action: DapControlAction) => {
      dapApi
        .control(projectId, action)
        .catch((e: unknown) => oculpmLog.error("dap", `dapControl failed: ${errorDetail(e)}`, { action }));
    },
    [projectId],
  );

  const variables = useCallback(
    async (reference: number) => {
      return dapApi.variables(projectId, reference).catch(() => []);
    },
    [projectId],
  );

  const breakpointsFor = useCallback(
    (path: string) => breakpoints.get(path) ?? [],
    [breakpoints],
  );
  const unverifiedFor = useCallback((path: string) => unverified.get(path) ?? [], [unverified]);
  const renamePath = useCallback((from: string, to: string, isDir: boolean) => {
    setBreakpoints((prev) => remapPathKeys(prev, from, to, isDir));
    setUnverified((prev) => remapPathKeys(prev, from, to, isDir));
  }, []);

  return {
    session,
    frames,
    selectedFrameId,
    selectFrame: setSelectedFrameId,
    output,
    clearOutput: useCallback(() => setOutput([]), []),
    breakpointsFor,
    unverifiedFor,
    toggleBreakpoint,
    renamePath,
    start,
    stop,
    control,
    variables,
    scopeRoots,
  };
}

/**
 * 어댑터가 확정한 중단점을 반영한다.
 *
 * 두 가지를 한꺼번에 한다: 옮겨진 줄을 따라가고(어댑터가 12→13 으로 옮길 수
 * 있다), 못 건 줄을 표시한다. 순수 함수로 빼 두어 테스트한다.
 */
export function mergeConfirmed(
  confirmed: readonly DapBreakpoint[],
): { lines: Map<string, number[]>; unverified: Map<string, number[]> } {
  const lines = new Map<string, number[]>();
  const unverified = new Map<string, number[]>();
  for (const bp of confirmed) {
    const list = lines.get(bp.path) ?? [];
    if (!list.includes(bp.line)) list.push(bp.line);
    list.sort((a, b) => a - b);
    lines.set(bp.path, list);
    if (!bp.verified) {
      const bad = unverified.get(bp.path) ?? [];
      if (!bad.includes(bp.line)) bad.push(bp.line);
      unverified.set(bp.path, bad);
    }
  }
  return { lines, unverified };
}

function applyConfirmed(
  confirmed: readonly DapBreakpoint[],
  setLines: React.Dispatch<React.SetStateAction<Map<string, number[]>>>,
  setUnverified: React.Dispatch<React.SetStateAction<Map<string, number[]>>>,
) {
  const merged = mergeConfirmed(confirmed);
  // 응답은 **그 파일에 대한 전량**이므로 그 파일만 갈아끼운다.
  setLines((prev) => {
    const next = new Map(prev);
    for (const [path, list] of merged.lines) next.set(path, list);
    return next;
  });
  setUnverified((prev) => {
    const next = new Map(prev);
    for (const [path] of merged.lines) next.set(path, merged.unverified.get(path) ?? []);
    return next;
  });
}
