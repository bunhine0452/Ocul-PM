// 상단바 — 탭 줄이 곧 제목이고, 오른쪽에 세션 id·사용량·터미널·패널.
//
// `AcpConversation.tsx` 에서 갈라 나온 **순수 뷰**다 (v3-surface {#acp-split}).
// 순수 이동이며 동작 변경은 없다.
//
// 원래 `ClaudeCodeScreenV2` 가 그렸는데 대화 화면으로 내렸다: 탭이 필요로 하는
// 것(세션 목록·현재 세션·열기·새로 만들기)이 전부 그 안에 있어서, 위에서
// 그리려면 상태를 통째로 밖으로 끌어내야 했다.

import { PanelLeft, Terminal, TriangleAlert, X } from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { useT } from "@/i18n";
import { AcpSessionTabs } from "../AcpSessionTabs";
import { AcpUsageMeter } from "../AcpUsageMeter";
import { SessionIdChip } from "../SessionIdChip";
import type { AcpTabItem } from "./useAcpTabs";

export function AcpToolbar({
  projectId,
  provider,
  tabs,
  activeId,
  slate,
  panelOpen,
  onPick,
  onClose,
  onOpenInTerminal,
  onTogglePanel,
}: {
  projectId: number;
  provider: "claude" | "codex";
  tabs: AcpTabItem[];
  activeId: string;
  /** 아직 안 만든 새 대화의 자리 — 이때는 세션 id 칩을 그리지 않는다. */
  slate: string;
  panelOpen: boolean;
  onPick: (id: string) => void;
  onClose: (id: string) => void;
  onOpenInTerminal: () => void;
  onTogglePanel: () => void;
}) {
  const { t } = useT();
  return (
    <Toolbar
      title={
        <AcpSessionTabs
          provider={provider}
          tabs={tabs}
          activeId={activeId}
          onPick={onPick}
          onClose={onClose}
        />
      }
    >
      {/* 지금 보고 있는 대화의 세션 id — 누르면 복사된다.
          패널을 열어야만 보이면 "터미널에서 이어서" 가 두 동작이 된다. */}
      {activeId === slate ? null : <SessionIdChip sessionId={activeId} />}
      <AcpUsageMeter projectId={projectId} provider={provider} />
      {/* 터미널로 나가는 문.
          어댑터는 CLI 가 가진 것 중 **자기가 노출하기로 한 것만** 준다 —
          `/remote-control`·`/login` 처럼 CLI 의 대화형 UI 에 사는 기능은 이
          화면에서 못 닿는다. 그럴 때 같은 프로젝트에서 진짜 `claude` 를 띄운다. */}
      <button
        type="button"
        className="btn icon ghost"
        onClick={onOpenInTerminal}
        aria-label={t("acp.openInTerminal")}
        title={t("acp.openInTerminal")}
      >
        <Terminal size={15} />
      </button>
      <button
        type="button"
        className={"btn icon ghost acp-panel-toggle" + (panelOpen ? " active" : "")}
        onClick={onTogglePanel}
        aria-pressed={panelOpen}
        aria-label={t("acp.history")}
        title={t("acp.history")}
      >
        <PanelLeft size={15} />
      </button>
    </Toolbar>
  );
}

/**
 * 실패한 지시 한 장.
 *
 * 오류의 답이 "복사해서 다시 치기"면 안 된다 — 같은 지시를 다시 보내는 길을
 * 카드 안에 둔다. 닫기는 "읽었다"는 표시다.
 */
export function AcpErrorCard({
  message,
  canRetry,
  onRetry,
  onDismiss,
}: {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useT();
  return (
    <div className="msg assistant">
      <div className="msg-head">
        <TriangleAlert size={13} style={{ color: "var(--t-bug)" }} />
        <span className="msg-model" style={{ color: "var(--t-bug)" }}>
          {t("ai.errorLabel")}
        </span>
        <span style={{ flex: 1 }} />
        {canRetry ? (
          <button type="button" className="msg-error-act" onClick={onRetry}>
            {t("acp.retrySend")}
          </button>
        ) : null}
        <button
          type="button"
          className="msg-error-act"
          aria-label={t("acp.errorDismiss")}
          title={t("acp.errorDismiss")}
          onClick={onDismiss}
        >
          <X size={12} />
        </button>
      </div>
      <div className="msg-error">{message}</div>
    </div>
  );
}
