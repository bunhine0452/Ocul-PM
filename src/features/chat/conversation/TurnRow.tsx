// 대화 한 턴 — 사용자 발화·계획·실패·복사·사고 라벨.
//
// AcpConversation.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSecondTick } from "@/hooks/useSecondTick";
import { Check, ChevronDown, Copy, File as FileIcon } from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import { useT } from "@/i18n";
import { turnReceipt, fileChangeDiscrepancy, type AcpBlock, type AcpPlanEntry, type AcpTurn } from "../acpTurns";
import { typedLength, wordDurationMs, wordKeyAt } from "../agentWords";
import { estimateTokens } from "@/lib/tokenEstimate";
import { ImageAttachment } from "./Attachments";
import { ActivityStream } from "../activity/ActivityStream";

/** 지시문을 몇 줄까지 접어 둘지 — 넘으면 "펼치기"가 붙는다. */
export const USER_CLAMP_LINES = 6;

/**
 * 사용자 지시 한 덩어리.
 *
 * 말풍선이 아니라 **카드**다. 말풍선은 오른쪽으로 밀리고 폭이 좁아 긴 지시문이
 * 계단처럼 꺾이는데, 여기서 쓰는 것은 한 줄 대꾸가 아니라 번호 붙은 요구사항
 * 묶음이다. 딸려 보낸 것도 같은 카드에 담겨야 "이 지시에 이 사진"이 한
 * 덩어리로 읽힌다.
 *
 * 길면 접는다. 지시문이 길수록 답도 길어서, 안 접으면 화면 위쪽을 지시문이 다
 * 먹고 정작 보려던 출력이 밀려난다.
 */
export function UserTurn({ turn }: { turn: AcpTurn }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);

  // 접힌 상태에서만 잰다 — 펼친 뒤에는 넘칠 것이 없어 `false` 가 되고,
  // 그러면 "접기" 버튼이 스스로 사라져 되돌릴 방법이 없어진다.
  useLayoutEffect(() => {
    if (expanded) return;
    const el = textRef.current;
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [expanded, turn.text]);

  return (
    <div className={"msg user" + (expanded ? " expanded" : "")}>
      <div
        className={"user-card" + (clipped && !expanded ? " clipped" : "")}
        // 펼치기는 **본문 어디를 눌러도** 된다 (작은 버튼을 겨냥할 필요 없이).
        // 접기는 버튼으로만 — 본문 클릭으로 접으면 긴 글을 읽다가 스크롤 대신
        // 잘못 눌렀을 때 읽던 자리가 통째로 사라진다.
        onClick={clipped && !expanded ? () => setExpanded(true) : undefined}
      >
        {/* 언제 시켰나 — 작업 콘솔인데 시각이 어디에도 없었다. 호버에만 보인다
            (상시 노출은 카드마다 숫자 벽지가 된다). 재생으로 복원한 턴에는
            시각이 없어 조용히 빠진다. */}
        {turn.at != null ? (
          <span className="user-card-time">
            {new Date(turn.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
        {turn.images?.length || turn.attachments?.length ? (
          <div className="user-card-files">
            {turn.images?.map((image, i) => (
              <ImageAttachment key={`i${i}`} image={image} />
            ))}
            {turn.attachments?.map((path) => (
              <span key={path} className="user-file" title={path}>
                <FileIcon size={12} />
                <span className="user-file-name">{path.split("/").pop()}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div
          ref={textRef}
          className="user-card-text"
          style={expanded ? undefined : { maxHeight: `calc(${USER_CLAMP_LINES} * 1.65em)` }}
        >
          {turn.text}
        </div>
        {clipped ? (
          <button
            type="button"
            className="user-card-more"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? t("acp.user.less") : t("acp.user.more")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 할 일 목록 — 진행 중인 것 하나가 눈에 먼저 들어와야 한다. */
export function PlanList({ entries }: { entries: readonly AcpPlanEntry[] }) {
  const { t } = useT();
  const done = entries.filter((entry) => entry.status === "completed").length;

  return (
    <details className="plan" open>
      <summary>
        <ChevronDown size={12} />
        <span className="plan-title">{t("acp.plan.title")}</span>
        <span className="plan-count">{t("acp.plan.count", { done, total: entries.length })}</span>
      </summary>
      <ul className="plan-list">
        {entries.map((entry, i) => (
          <li key={i} className={"plan-item " + entry.status}>
            <span className="plan-mark" aria-hidden="true" />
            <span className="plan-text">{entry.content}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** 끝난 답변의 전체 복사 버튼 — 호버에만 보인다 (상시 노출은 벽지가 된다). */
export function TurnCopy({ text }: { text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* 클립보드가 없는 환경 — 조용히 지나간다 */
    }
  }, [text]);
  return (
    <button
      type="button"
      className={"turn-copy" + (copied ? " done" : "")}
      onClick={() => void copy()}
      aria-label={t("acp.copyTurn")}
      title={t("acp.copyTurn")}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

/**
 * 생각 줄 — 도는 동안은 "생각하는 중 · N 토큰", 끝나면 "18초 생각함".
 *
 * 토큰 수는 **추정치**다(생각 텍스트 길이 기반). 프로토콜이 생각 토큰을 따로
 * 주지 않으므로 정확한 값을 만들어 낼 수 없다 — 진행 감각을 주는 것이 목적이고,
 * 끝난 뒤에는 추정 대신 **실제로 잰 시간**을 보여 준다.
 */
export function ThinkingLabel({ turn, live }: { turn: AcpTurn; live: boolean }) {
  const { t } = useT();
  const thinking = live && turn.thought != null && turn.thoughtEnd == null;

  // 도는 동안은 1초마다 다시 그린다 — 숫자가 멈춰 있으면 멈춘 것처럼 보인다.
  // (공유 시계 — 컴포넌트마다 인터벌을 들지 않는다, Phase 3.)
  useSecondTick(thinking);

  if (thinking) {
    return (
      <span className="think-live">
        {t("acp.thinking.live")}
        <span className="think-dots" aria-hidden="true" />
        <span className="think-meta">
          {t("acp.thinking.tokens", { n: estimateTokens(turn.thought ?? "") })}
        </span>
      </span>
    );
  }

  if (turn.thoughtStart != null && turn.thoughtEnd != null) {
    const sec = Math.max(1, Math.round((turn.thoughtEnd - turn.thoughtStart) / 1000));
    return <span>{t("acp.thinking.done", { sec })}</span>;
  }
  return <span>{t("acp.thinking")}</span>;
}

/**
 * 작업 중 상태 단어 — 한 글자씩 찍히고, 다 찍히면 잠시 머물다 다음 말로 넘어간다.
 *
 * 스피너 대신 쓰는 이유는 agentWords.ts 에 적었다: 기다림을 초조함이 아니라
 * 진행으로 읽히게 하려는 것이다.
 */
export function AgentWord() {
  const { t } = useT();
  const [tickIndex, setTickIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const word = t(wordKeyAt(tickIndex));
  const total = word.length;

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const ms = Date.now() - started;
      setElapsed(ms);
      if (ms >= wordDurationMs(total)) {
        setTickIndex((n) => n + 1);
      }
    }, 55);
    return () => window.clearInterval(timer);
  }, [total, tickIndex]);

  const typed = typedLength(elapsed, total);

  return (
    <div className="agent-word">
      {/* 타이핑되는 글자에 라이브 리전을 걸면 읽어 주는 기계가 "빚", "빚는",
          "빚는 중"을 연타로 읽는다 — 완성된 단어만 따로 한 번 알린다. */}
      <span aria-hidden="true">{word.slice(0, typed)}</span>
      <span className="agent-word-caret" aria-hidden="true" />
      <span className="trace-sr" aria-live="polite">
        {typed >= total ? word : ""}
      </span>
    </div>
  );
}

export const TurnRow = memo(function TurnRow({
  turn,
  live,
}: {
  turn: AcpTurn;
  live: boolean;
}) {
  const { t } = useT();

  if (turn.role === "user") return <UserTurn turn={turn} />;

  // 구분선은 **받은 문장을 그대로** 건다. 예전엔 여기서 "…로 전환"을 붙였는데,
  // 그러면 모델 교체 말고는 아무 것도 이 자리에 못 넣는다 — 대화에 일어나는
  // 일은 그것만이 아니다.
  if (turn.role === "notice") {
    return (
      <div className="turn-notice" role="separator">
        <span className="turn-notice-label">{turn.text}</span>
      </div>
    );
  }

  // 옛 기록(블록 이전)도 그려야 한다 — 글 한 덩어리로 폴백한다.
  const blocks: AcpBlock[] =
    turn.blocks ?? (turn.text ? [{ kind: "text", text: turn.text }] : []);

  const receipt = turnReceipt(turn);
  // 에이전트가 신고한 파일 변경이 추론 영수증과 어긋날 때만 한 줄 더 붙인다.
  const discrepancy = fileChangeDiscrepancy(turn);

  return (
    <div className={"msg assistant" + (live ? " streaming" : "")}>
      {/* 이름을 적지 않는다 — 답이 하나뿐인 화면에서 매 턴 "Claude Agent" 를
          반복하면 정보가 아니라 소음이다.

          진행 표시용 점도 따로 두지 않는다. 레일이 이미 단계마다 점을 찍고 그
          중 도는 것은 맥박이 뛴다 — 위에 점 하나를 더 얹으면 점이 두 개가 되고,
          "빚는 중…" 같은 상태 문구와 **줄이 갈라진다**. 점은 그 문구의 줄에
          있어야 둘이 한 말로 읽힌다. */}
      {/* 답 전체 복사 — 코드펜스에는 이미 복사가 있지만 "답을 통째로"는
          긁어서 고르는 수밖에 없었다. 끝난 턴에만 — 흐르는 글의 복사는 반쪽이다. */}
      {!live && turn.text.trim() ? <TurnCopy text={turn.text} /> : null}
      {turn.thought ? (
        <details className="think">
          <summary>
            <ChevronDown size={12} />
            <ThinkingLabel turn={turn} live={live} />
          </summary>
          <div className="think-body msg-md">
            <Markdown>{turn.thought}</Markdown>
          </div>
        </details>
      ) : null}
      {/* 할 일 목록은 조각 흐름 **위**에 하나로 둔다 — 진행 상황을 훑는 물건이라
          글·도구 더미 아래에 두면 긴 턴에서 매번 스크롤로 찾아야 한다. 매 갱신에
          전체가 새로 오므로 이 자리에서 통째로 바뀐다. */}
      {turn.plan?.length ? <PlanList entries={turn.plan} /> : null}
      {/* 글과 도구를 **온 순서 그대로** 그린다. 예전엔 도구를 전부 위에, 글을
          전부 아래에 모아 그려서 — 도구 사이사이에 한 줄씩 하던 설명이 맨
          아래에 줄줄이 붙어 서로 다른 대목의 문장이 한 문단처럼 이어졌다.

          무엇을 한 것인지 판정하고(우리 어휘로) 이웃끼리 묶는 일은
          `activity/` 가 소유한다 — 여기서는 흐름을 그 자리에 놓기만 한다. */}
      <ActivityStream blocks={blocks} live={live} />
      {/* 턴 영수증 — 이 턴이 실제로 무엇을 했는지 한 줄. 일지 제품의 DNA 를
          대화 표면에 남기는 자리다. 도구를 쓴 턴에만 — "도구 0" 은 소음이다. */}
      {receipt ? (
        <div className="turn-receipt">
          {[
            t("acp.receipt.tools", { n: receipt.tools }),
            receipt.files ? t("acp.receipt.files", { n: receipt.files }) : null,
            receipt.commands ? t("acp.receipt.commands", { n: receipt.commands }) : null,
            receipt.seconds == null
              ? null
              : receipt.seconds < 60
                ? t("acp.receipt.sec", { s: receipt.seconds })
                : receipt.seconds % 60 === 0
                  ? t("acp.receipt.min", { m: Math.floor(receipt.seconds / 60) })
                  : t("acp.receipt.minSec", {
                      m: Math.floor(receipt.seconds / 60),
                      s: receipt.seconds % 60,
                    }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}
      {/* 에이전트가 직접 신고한 파일 변경 — 도구 흔적으로 센 영수증과 다를
          때만 나온다. 같은 수를 두 번 적으면 소음이라, 어긋남 자체가 정보다.
          (명령이나 자식 프로세스가 바꾼 파일은 편집 도구 호출로 안 잡힌다.) */}
      {discrepancy ? (
        <div className="turn-receipt turn-receipt-audit" title={t("acp.audit.why")}>
          {discrepancy.kind === "extra"
            ? t("acp.audit.extra", {
                declared: discrepancy.declared,
                inferred: discrepancy.inferred,
              })
            : discrepancy.kind === "partial"
              ? discrepancy.uncertainty
                ? t("acp.audit.partialWhy", {
                    n: discrepancy.declared,
                    why: discrepancy.uncertainty,
                  })
                : t("acp.audit.partial", { n: discrepancy.declared })
              : t("acp.audit.missing", { reason: discrepancy.reason })}
        </div>
      ) : null}
      {blocks.length === 0 ? (
        live ? (
          <AgentWord />
        ) : (
          <div className="msg-wait">{t("acp.waiting")}</div>
        )
      ) : null}
    </div>
  );
});
