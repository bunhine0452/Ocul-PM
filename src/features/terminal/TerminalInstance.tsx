import { lazy, Suspense } from "react";

// v2 U6 — xterm(+addon-fit, css) 은 TerminalInstanceImpl 로 분리해 lazy 로드.
// TodayTerminal 위젯이 eager 화면(Today)에서 이 컴포넌트를 임포트하는 바람에
// xterm 전체가 ShellV2 초기 청크에 실려 있었다. 실제 마운트는 사용자가
// 터미널을 열 때만 일어나므로(TodayTerminal 은 접힘 기본, 터미널 화면은 lazy)
// 그 시점에 청크를 받는다. 소비처 임포트 경로·props 는 불변.

const TerminalInstanceImpl = lazy(() => import("./TerminalInstanceImpl"));

interface TerminalInstanceProps {
  sessionId: string;
  cwd: string;
  visible: boolean;
  fontSize?: number;
}

export function TerminalInstance(props: TerminalInstanceProps) {
  return (
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
  );
}
