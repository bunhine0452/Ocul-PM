/**
 * 스레드 본문 — 지시와 답의 묶음 · 승인 카드 · 알림들 · 오류 카드 · 「맨 아래로」
 * (플랜 `v3-release` {#big-files-watch}).
 *
 * `AcpConversation.tsx` 에서 그대로 들어냈다. 화면이 그리는 면은 넷인데(툴바 ·
 * 스레드 · 컴포저 · 세션 패널) 나머지 셋은 이미 자기 파일이 있었고 스레드만
 * 본체에 남아 있었다. 마크업·클래스·조건은 원본 그대로다.
 *
 * 스크롤 정책은 여기서 정하지 않는다 — `useThreadScroll` 이 소유하고, 이
 * 컴포넌트는 그 훅이 준 것들을 스크롤러에 붙이기만 한다.
 */

import { ArrowDown } from "@/components/Icons";
import { useT } from "@/i18n";

import { AgentGoneNotice, JournalGateNotice, RecordingNotice } from "../RecordingNotice";
import { type AcpTurn } from "../acpTurns";
import { AcpErrorCard } from "./AcpToolbar";
import { PermissionCard } from "./PermissionCard";
import { type PermissionState } from "./shared";
import { AcpReadyPanel } from "./StartPanels";
import { TurnRow } from "./TurnRow";

export interface AcpThreadProps {
  projectId: number;
  provider: "claude" | "codex";
  sessionId: string | null;
  codex: boolean;
  /** 스크롤러를 붙잡는 ref + 스크롤 이벤트 (`useThreadScroll`). */
  attachThread: (el: HTMLDivElement | null) => void;
  onThreadScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  awayFromBottom: boolean;
  jumpToBottom: () => void;
  /** 보고 있는 대화의 턴과 그 묶음. */
  turns: AcpTurn[];
  groups: AcpTurn[][];
  busy: boolean;
  permission: PermissionState | null;
  onDecide: (requestId: string, optionId: string | null) => void;
  agentGone: boolean;
  starting: boolean;
  onReconnect: () => void;
  error: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onDismissError: () => void;
}

export function AcpThread({
  projectId,
  provider,
  sessionId,
  codex,
  attachThread,
  onThreadScroll,
  awayFromBottom,
  jumpToBottom,
  turns,
  groups,
  busy,
  permission,
  onDecide,
  agentGone,
  starting,
  onReconnect,
  error,
  canRetry,
  onRetry,
  onDismissError,
}: AcpThreadProps) {
  const { t } = useT();
  return (
    <div className="ai-thread" ref={attachThread} onScroll={onThreadScroll}>
      <div className="ai-thread-inner">
        {turns.length === 0 ? (
          <AcpReadyPanel codex={codex} />
        ) : (
          /* 묶음(지시 + 그 답)을 **실제 요소로** 그린다 — 지시문 sticky 의
             컨테이닝 블록이 이 묶음이어야 자기 답변이 끝날 때 자리를 비운다.
             평평하게 늘어놓았더니 카드가 top 에 겹겹이 쌓였다. */
          groups.map((group, gi, all) => (
            <section className="exchange" key={gi}>
              {group.map((turn, i) => (
                <TurnRow
                  key={i}
                  turn={turn}
                  live={busy && gi === all.length - 1 && i === group.length - 1}
                />
              ))}
            </section>
          ))
        )}

        {permission ? <PermissionCard request={permission} onDecide={onDecide} /> : null}

        {agentGone ? <AgentGoneNotice starting={starting} onReconnect={onReconnect} /> : null}

        {/* 기록 도구 없이 열린 대화를 드러낸다 ({#mcp-missing-visible}) —
            붙었으면 아무 것도 안 그린다. */}
        <RecordingNotice projectId={projectId} provider={provider} sessionId={sessionId} />

        {/* 배달 게이트 — 턴이 끝날 때마다 다시 묻는다 ({#gate-beyond-cc}). */}
        <JournalGateNotice sessionId={sessionId} turnKey={busy} />

        {error ? (
          <AcpErrorCard
            message={error}
            canRetry={canRetry}
            onRetry={onRetry}
            onDismiss={onDismissError}
          />
        ) : null}
      </div>
      {awayFromBottom ? (
        /* 위에서 앞 카드를 읽는 것은 허용된 동작이다 (stickRef) — 그렇다면
           돌아오는 길도 한 번의 클릭이어야 한다. */
        <button
          type="button"
          className="ai-scroll-fab"
          onClick={jumpToBottom}
          aria-label={t("ai.scrollBottom")}
          title={t("ai.scrollBottom")}
        >
          <ArrowDown size={15} />
        </button>
      ) : null}
    </div>
  );
}
