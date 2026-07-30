import { Component, Fragment, type ReactNode } from "react";
import { oculpmLog } from "@/lib/oculpmLog";

// 실기기 A0d 발견(2026-07-31): TerminalInstanceImpl 예외가 경계 없이 올라가
// React 가 트리를 통째로 언마운트 — 앱 전체가 빈 화면이 됐다. 이 경계는
// `TerminalInstance` 래퍼 **내부**에 산다 — 터미널 화면·Today 위젯 등 모든
// 소비처가 자동으로 보호되고, 실스택은 oculpm.log 에 남는다. "다시 열기"는
// 내부 nonce 로 하위 트리를 재마운트한다 (persistent PTY 는 백엔드에 살아
// 있어 재접속으로 이어진다).

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  nonce: number;
}

export class TerminalErrorBoundary extends Component<Props, State> {
  state: State = { error: null, nonce: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    oculpmLog.error(
      "terminal",
      `터미널 페인 크래시: ${error.name}: ${error.message}\n${error.stack ?? ""}\n컴포넌트: ${info.componentStack ?? "?"}`,
    );
  }

  render() {
    if (this.state.error == null) {
      return <Fragment key={this.state.nonce}>{this.props.children}</Fragment>;
    }
    return (
      <div
        role="alert"
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 10, height: "100%", minHeight: 120, padding: 24, color: "var(--text-2)", fontSize: 13, textAlign: "center",
        }}
      >
        <strong style={{ color: "var(--text-1)" }}>터미널 렌더러 오류</strong>
        <code style={{ fontSize: 11, color: "var(--text-3)", maxWidth: 480, overflow: "hidden", textOverflow: "ellipsis" }}>
          {this.state.error.message}
        </code>
        <span>세션은 백엔드에 살아 있어요 — 다시 열면 이어집니다. 상세는 진단 로그(oculpm.log)에 남겼어요.</span>
        <button
          type="button"
          className="btn"
          onClick={() => this.setState((s) => ({ error: null, nonce: s.nonce + 1 }))}
        >
          다시 열기
        </button>
      </div>
    );
  }
}
