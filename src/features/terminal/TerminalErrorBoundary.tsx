import { Component, Fragment, type ReactNode } from "react";
import { oculpmLog } from "@/lib/oculpmLog";
// 클래스 컴포넌트라 훅을 쓸 수 없다 — 모듈 t(). 언어 전환은 이 경계가
// 떠 있는 동안에만 반영이 늦는데, 크래시 화면은 곧 재마운트되므로 무시한다.
import { t } from "@/i18n";

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
      // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
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
        <strong style={{ color: "var(--text-1)" }}>{t("term.crashTitle")}</strong>
        <code style={{ fontSize: 11, color: "var(--text-3)", maxWidth: 480, overflow: "hidden", textOverflow: "ellipsis" }}>
          {this.state.error.message}
        </code>
        <span>{t("term.crashBody")}</span>
        <button
          type="button"
          className="btn"
          onClick={() => this.setState((s) => ({ error: null, nonce: s.nonce + 1 }))}
        >
          {t("term.crashReopen")}
        </button>
      </div>
    );
  }
}
