import { lazy, Suspense } from "react";
import type { TerminalHandles } from "./TerminalInstanceImpl";
import type { ShellState } from "./oscShell";
import { TerminalErrorBoundary } from "./TerminalErrorBoundary";

// v2 U6 — xterm(+addons, css) 은 TerminalInstanceImpl 로 분리해 lazy 로드.
// TodayTerminal 위젯이 eager 화면(Today)에서 이 컴포넌트를 임포트하는 바람에
// xterm 전체가 ShellV2 초기 청크에 실려 있었다. 실제 마운트는 사용자가
// 터미널을 열 때만 일어나므로(TodayTerminal 은 접힘 기본, 터미널 화면은 lazy)
// 그 시점에 청크를 받는다. 소비처 임포트 경로·props 는 불변.
// (import type 은 컴파일 타임에 지워져 xterm 을 eager 그래프로 끌지 않는다.)

const TerminalInstanceImpl = lazy(() => import("./TerminalInstanceImpl"));

interface TerminalInstanceProps {
  sessionId: string;
  cwd: string;
  visible: boolean;
  fontSize?: number;
  /** true 면 unmount 시 PTY 유지 — 터미널 화면(탭/분할)이 사용. 기본 false. */
  persistent?: boolean;
  /** visible 전환 시 자동 포커스 (분할 페인에선 포커스 페인만 true). */
  autoFocus?: boolean;
  onReady?: (handles: TerminalHandles) => void;
  onFocusIn?: () => void;
  /** 셸이 OSC 0/2 로 알려온 제목 — 탭 자동 이름 (2026-07-30). */
  onTitleChange?: (title: string) => void;
  /** 셸 통합(OSC 133/7) 상태 — 미설치 세션에서는 한 번도 불리지 않는다. */
  onShellState?: (state: ShellState) => void;
  /** 출력 안의 `파일:줄` ⌘클릭. 없으면 링크를 만들지 않는다. */
  onOpenFileRef?: (path: string, line: number | null) => void;
}

export type { TerminalHandles, ShellState };

export function TerminalInstance(props: TerminalInstanceProps) {
  // 경계가 래퍼 안에 있어 모든 소비처(터미널 화면·Today 위젯)가 보호된다 —
  // A0d 크래시(경계 밖 소비처에서 앱 전체 언마운트)의 재발 방지.
  return (
    <TerminalErrorBoundary>
    <Suspense
      fallback={
        <div
          className="skel"
          style={{ height: "100%", minHeight: 120 }}
          role="status"
          aria-label="터미널 불러오는 중"
        />
      }
    >
      <TerminalInstanceImpl {...props} />
    </Suspense>
    </TerminalErrorBoundary>
  );
}
