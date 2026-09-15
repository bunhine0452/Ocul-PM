// 페인별 상태 맵(셸 통합·신호·핍·종료·재시작 nonce) 과 xterm 핸들 레지스트리 —
// `TerminalSurface.tsx` 에서 옮겨 왔다 (2026-09-15 분할). 닫힌 세션의 회수(reap)
// 이펙트는 탭 생명주기 이펙트 옆, 본체에 그대로 있다 — 이펙트 순서를 지키기 위해.
import { useRef, useState } from "react";
import type { TerminalHandles, ShellState } from "../TerminalInstance";
import type { PaneSignal } from "../agentMode";
import type { PanePip } from "../TerminalPaneHead";

export function usePaneStates() {
  // sid → xterm 핸들 (검색/포커스 제어). onReady 로 채워진다.
  const regRef = useRef(new Map<string, TerminalHandles>());

  // sid → 셸 통합 상태(OSC 133). 통합이 설치되지 않은 세션은 여기 안 들어온다.
  const [shellStates, setShellStates] = useState<Record<string, ShellState>>({});
  // sid → 페인 신호(alt-screen · BEL · 마지막 출력). 셸 통합과 **독립**으로
  // 온다 — 둘을 합쳐 "에이전트가 나를 기다리는가"를 판정한다 (→ agentMode).
  const [paneSignals, setPaneSignals] = useState<Record<string, PaneSignal>>({});
  // 페인별 최근 명령 결과 (머리띠 핍). 명령 경계(OSC 133)에서만 바뀌므로 셸
  // 상태 갱신에 얹어 읽는다 — 블록 목록 자체는 xterm 마커라 인스턴스가 쥔다.
  const [blockPips, setBlockPips] = useState<Record<string, PanePip[]>>({});
  /**
   * 셸이 스스로 끝난 페인 (2026-09-02).
   *
   * 예전에는 `[프로세스 종료됨]` 한 줄을 찍고 끝이었다. 탭은 그대로 남고 PTY 만
   * 사라지므로, 거기 타이핑하면 백엔드의 "unknown pty session" 이 조용히
   * 버려졌다 — 사용자 눈에는 **먹통이 된 터미널**이고, 탭을 닫았다 여는 것
   * 말고는 되살릴 길이 없었다. 이제 사실을 말하고 손잡이를 준다.
   */
  const [ended, setEnded] = useState<Record<string, true>>({});
  /**
   * 다시 시작 횟수 — `TerminalInstance` 의 `key` 에 실어 **제자리 재마운트**를
   * 만든다. 세션 id 는 그대로라 마운트 경로(attach → 없음 → start)가 같은
   * 자리에 새 셸을 세운다.
   */
  const [restartNonce, setRestartNonce] = useState<Record<string, number>>({});

  /**
   * 끝난 셸을 그 자리에서 다시 세운다. 세션 id 는 그대로 두고 xterm 만 새로
   * 만든다 — 탭·분할 배치도, 사용자가 지은 이름도 그대로다.
   */
  const restartPane = (sid: string) => {
    const drop = <T,>(prev: Record<string, T>): Record<string, T> => {
      if (!(sid in prev)) return prev;
      const next = { ...prev };
      delete next[sid];
      return next;
    };
    setEnded(drop);
    // 죽은 셸의 마지막 상태·신호는 새 셸의 것이 아니다 — 함께 걷는다.
    setShellStates(drop);
    setPaneSignals(drop);
    setRestartNonce((prev) => ({ ...prev, [sid]: (prev[sid] ?? 0) + 1 }));
  };

  return {
    regRef,
    shellStates,
    setShellStates,
    paneSignals,
    setPaneSignals,
    blockPips,
    setBlockPips,
    ended,
    setEnded,
    restartNonce,
    setRestartNonce,
    restartPane,
  };
}
