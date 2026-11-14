import { Component, Fragment, type ReactNode } from "react";
import { ErrorCard } from "@/components/ErrorCard";
import { oculpmLog } from "@/lib/oculpmLog";
// 클래스 컴포넌트라 훅을 쓸 수 없다 — 모듈 t(). 이 경계가 떠 있는 동안에만
// 언어 전환 반영이 늦는데, 크래시 화면은 "다시 시도" 로 곧 사라진다
// (TerminalErrorBoundary 와 같은 판단).
import { t } from "@/i18n";

/**
 * 범용 렌더 경계 — **창 하나가 통째로 죽는 것**을 막는다.
 *
 * 같은 실패가 두 번 나왔다:
 *  - 2026-07-31 터미널 페인 예외 → 앱 전체가 빈 화면 (`TerminalErrorBoundary`
 *    로 그 자리에서 막았다)
 *  - 2026-08-16 시작 탭 설정의 ocul-pm 화면이 `useWorkspace()` 로 throw →
 *    창 트리가 통째로 언마운트되어 창 전체가 빈 화면
 *
 * 둘 다 원인은 달랐지만 증상은 같다. React 는 경계가 없으면 **루트까지**
 * 언마운트하므로, 화면 한 조각의 버그가 창 전체를 못 쓰게 만든다. 그래서
 * 경계를 두 층에 둔다: 탭 하나(`TabbedWindow` 의 탭 패널)와, 그 안에서
 * 따로 죽어도 되는 조각(설정 패널). 안쪽이 먼저 잡으면 바깥 탭은 멀쩡하다.
 *
 * 터미널은 재접속 문구가 따로 필요해 `TerminalErrorBoundary` 를 그대로 둔다.
 */
interface Props {
  /**
   * 진단 로그에 남길 경계 이름 (`oculpm.log` 에서 어느 조각이 죽었는지
   * 구분하는 유일한 단서 — "settings" · "tab" 처럼 짧게).
   */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** 올릴 때마다 하위 트리를 새로 마운트한다 — "다시 시도" 의 구현. */
  nonce: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, nonce: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    oculpmLog.error(
      "ui",
      // i18n-ignore-next-line -- 진단 로그(oculpm.log)는 한 언어로 남긴다
      `화면 크래시 [${this.props.label}]: ${error.name}: ${error.message}\n${error.stack ?? ""}\n컴포넌트: ${info.componentStack ?? "?"}`,
    );
  }

  // 오류 카드 한 벌 (11-15) — 가운데 정렬 인라인 리터럴 대신 화면의 다른 실패와 같은 모양으로, 본문
  // 왼쪽 선에 선다. 「다시 시도」 는 경계를 비우고 하위 트리를 새로 마운트한다.
  render() {
    if (this.state.error == null) {
      return <Fragment key={this.state.nonce}>{this.props.children}</Fragment>;
    }
    return (
      <div className="err-wrap">
        <ErrorCard
          title={t("crash.title")}
          error={this.state.error.message}
          onRetry={() => this.setState((s) => ({ error: null, nonce: s.nonce + 1 }))}
        >
          {t("crash.body")}
        </ErrorCard>
      </div>
    );
  }
}
