import { Component, type ReactNode } from "react";
import { oculpmLog } from "@/lib/oculpmLog";

// 실기기 A0d 발견(2026-07-31): TerminalInstanceImpl 내부 예외가 경계 없이
// 올라가 React 가 트리를 통째로 언마운트 — 터미널이 "빈 화면 + 무반응"이 되고
// 이후 어느 화면으로 가도 빈 화면이었다. 페인 단위 경계로 폭발 반경을 페인
// 하나로 가두고, 실제 스택을 oculpm.log 에 남긴다 (React 19 는 에러 경계가
// 없으면 콘솔 포맷 문자열로만 흘려 포렌식이 안 됐다).

interface Props {
  /** 폴백에서 "다시 열기"를 누르면 호출 — 부모가 key 를 바꿔 재마운트한다. */
  onRetry: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class TerminalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    oculpmLog.error(
      "terminal",
      `터미널 페인 크래시: ${error.name}: ${error.message}\n${error.stack ?? ""}\n컴포넌트: ${info.componentStack ?? "?"}`,
    );
  }

  render() {
    if (this.state.error == null) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 10, height: "100%", padding: 24, color: "var(--text-2)", fontSize: 13, textAlign: "center",
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
          onClick={() => {
            this.setState({ error: null });
            this.props.onRetry();
          }}
        >
          다시 열기
        </button>
      </div>
    );
  }
}
