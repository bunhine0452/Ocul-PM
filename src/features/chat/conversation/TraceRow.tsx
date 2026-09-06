// 도구 호출 트레이스 한 줄 — 경과시간·입출력 토글.
//
// AcpConversation.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { memo, useCallback, useMemo, useState } from "react";
import { useSecondTick } from "@/hooks/useSecondTick";
import { Check, ChevronDown, Code2, Copy, type IconComponent } from "@/components/Icons";
import { useT } from "@/i18n";
import { type AcpToolCall } from "../acpTurns";
import { AcpDiffView } from "../AcpDiffView";
import { diffLines, diffStats } from "../lineDiff";
import { PEEK_IN_LINES, PEEK_OUT_LINES, peekLines } from "../tracePreview";
import { TOOL_ICON, TOOL_STATUS_KEY } from "./shared";
import { RawRail } from "../activity/RawRail";

/** 도는 단계의 경과 초 — 1초마다 다시 그린다 (그 단계가 도는 동안만). */
export function TraceElapsed({ since }: { since?: number }) {
  // 도는 단계마다 하나씩 인터벌을 들던 것을 공유 시계로 (Phase 3).
  const now = useSecondTick(since != null);
  if (since == null) return null;
  const sec = Math.max(0, Math.round((now - since) / 1000));
  // 첫 1~2초는 적지 않는다 — 모든 단계에 "· 0s" 가 붙으면 벽지가 된다.
  if (sec < 3) return null;
  return <span className="trace-elapsed"> · {sec}s</span>;
}

/**
 * 펼친 본문의 IN/OUT 한 칸 — 호버에 복사가 뜬다.
 *
 * 도구 출력은 이 화면에서 가장 자주 **다른 곳으로 가져가는** 글이다(오류
 * 메시지를 검색하고, 명령을 다시 치고). 긁어 고르기가 유일한 길이면 안 된다.
 */
export function TraceIo({ tag, text }: { tag: string; text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* 클립보드가 없는 환경 */
    }
  }, [text]);
  return (
    <div className="trace-io">
      <span className="trace-io-tag">{tag}</span>
      <pre>{text}</pre>
      <button
        type="button"
        className={"trace-io-copy" + (copied ? " done" : "")}
        onClick={() => void copy()}
        aria-label={t("acp.copyIo")}
        title={t("acp.copyIo")}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </div>
  );
}

/**
 * 활동 어휘가 이 줄에 씌우는 **얼굴** (`activity/presenters.tsx`).
 *
 * 없으면 도구 종류로 폴백한다 — 이 컴포넌트는 어휘를 몰라도 혼자 선다
 * (기존 호출부와 테스트가 그대로 돈다).
 */
export interface TracePresent {
  Icon: IconComponent;
  /** 줄 앞머리의 이름 한 낱말 — "일지 기록" 처럼 **우리 말**이 들어온다. */
  name: string;
  /**
   * 줄의 결. `ledger` 는 우리 원장 기록(눈에 걸려야 한다), `aside` 는 곁가지
   * (생각처럼 답이 아니라 과정인 것 — 한 톤 물러난다).
   */
  tone?: "ledger" | "aside";
}

/**
 * 도구 호출 한 단계 — 무엇을 시켰고, 무엇이 나왔나.
 *
 * 예전에는 끝나면 한 줄로 접혀서, 스무 번 도구를 쓴 대화가 **똑같이 생긴 스무
 * 줄**이 됐다. 무엇이 나왔는지는 하나씩 펼쳐야 알 수 있었고, 그래서 아무도
 * 안 펼쳤다. 반대로 전문을 다 펼치면 수백 줄짜리 출력이 답변을 화면 밖으로
 * 밀어낸다.
 *
 * 그 사이를 고른다: **결과의 머리 몇 줄을 항상 보여 주고**(tracePreview.ts),
 * 아래를 페이드로 잘라 더 있음을 알린다. 누르면 들어간 것(IN)과 나온 것(OUT)
 * 전문이 열린다. 훑기만 해도 흐름이 읽히고, 파고들 때만 자리를 내준다.
 */
export const TraceRow = memo(function TraceRow({
  tool,
  present,
  raw,
}: {
  tool: AcpToolCall;
  present?: TracePresent;
  /** 원본 이벤트 — 펼친 본문 맨 아래 레일 (`{#raw-rail}`). */
  raw?: unknown;
}) {
  const { t } = useT();
  const running = tool.status === "in_progress" || tool.status === "pending";
  const failed = tool.status === "failed";
  /**
   * 접힘/펼침은 사용자가 정하되, **기본값은 진행 중이면 펼침**이다. 돌고 있는
   * 동안에는 "무엇을 시켰는지"가 곧 진행 상황이다. `null` 은 "아직 안 건드림".
   */
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? running;
  const Icon = present?.Icon ?? TOOL_ICON[tool.kind] ?? Code2;
  const statusKey = TOOL_STATUS_KEY[tool.status as keyof typeof TOOL_STATUS_KEY];
  const state = running ? " running" : failed ? " failed" : "";
  // 원본 레일도 펼칠 거리다 — 입출력이 하나도 없는 카드에서 **유일한** 거리다.
  const expandable = Boolean(tool.input || tool.output || tool.diffs?.length || raw);

  /**
   * 변경 규모("+12 −3") — 펼치기 전에 줄에서 바로 읽힌다. 어떤 파일을 몇 줄
   * 고쳤는지가 이 카드의 핵심 정보인데, 예전엔 펼쳐야만 보였다.
   */
  const diffTotals = useMemo(() => {
    if (!tool.diffs?.length) return null;
    let added = 0;
    let removed = 0;
    for (const diff of tool.diffs) {
      const stats = diffStats(diffLines(diff.old_text, diff.new_text));
      added += stats.added;
      removed += stats.removed;
    }
    return { added, removed };
  }, [tool.diffs]);

  /**
   * 미리보기 — 명령(IN)의 머리 두 줄과 결과(OUT)의 머리 네 줄.
   *
   * **IN 은 명령을 실행한 단계에서만** 보여 준다. 줄에 적히는 제목은 모델이
   * 쓴 설명("ACP 백엔드의 취소 경로 찾기")이라 실제로 무엇이 돌았는지는 여기
   * 말고는 볼 데가 없다. 반대로 읽기·편집은 대상 경로가 이미 줄에 있어서
   * 같은 것을 두 번 적는 꼴이 된다 — 그 자리는 결과에 내준다.
   */
  const peek = useMemo(() => {
    const wantsInput = Boolean(tool.input) && (tool.kind === "execute" || !tool.output);
    const input = wantsInput ? peekLines(tool.input ?? "", PEEK_IN_LINES) : null;
    const output = tool.output ? peekLines(tool.output, PEEK_OUT_LINES) : null;
    return {
      input,
      output,
      empty: !input?.text && !output?.text,
      truncated: Boolean(input?.truncated || output?.truncated),
      hidden: (input?.hiddenLines ?? 0) + (output?.hiddenLines ?? 0),
    };
  }, [tool.output, tool.input, tool.kind]);

  const status = statusKey ? t(statusKey) : tool.status;

  return (
    <div className={"trace-item" + (open ? " open" : "") + (present?.tone ? " " + present.tone : "")}>
      <button
        type="button"
        className={"trace-row" + state}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setChoice(!open)}
      >
        <span className="trace-icon">
          <Icon size={13} />
        </span>
        {/* 이름과 설명을 가른다. 예전엔 명령줄 전체가 제목 자리에 들어가서,
            줄이 길수록 "무슨 도구였나"가 말줄임 뒤로 사라졌다. 이름은 짧고
            늘 같은 자리에 있어야 훑을 때 걸린다 (Claude Code 벤치마크). */}
        <span className="trace-name">{present?.name || tool.name || t("acp.tool.untitled")}</span>
        <span className="trace-title">{tool.subtitle || tool.title}</span>
        {tool.locations.length ? (
          <span className="trace-path" title={tool.locations.join("\n")}>
            {tool.locations[0]}
          </span>
        ) : null}
        {tool.locations.length > 1 ? (
          <span className="trace-more">+{tool.locations.length - 1}</span>
        ) : null}
        {/* 변경 규모는 상태와 무관하게 늘 보인다 — "무엇을 얼마나 고쳤나"가
            이 줄의 존재 이유다. */}
        {diffTotals ? (
          <span className="trace-diffstat">
            {diffTotals.added ? <span className="add">+{diffTotals.added}</span> : null}
            {diffTotals.removed ? <span className="del">−{diffTotals.removed}</span> : null}
          </span>
        ) : null}
        {/* 상태 글자는 **말할 것이 있을 때만**. 스무 줄에 "완료"가 스무 번
            적혀 있으면 그건 정보가 아니라 벽지다 — 끝난 단계는 아무 말도 하지
            않는 것이 곧 "잘 끝났다"이고, 눈은 그 사이의 빨강만 찾으면 된다.
            눈에서 지우는 것과 **없애는 것**은 다르다: 읽어 주는 기계에는 늘
            남는다 (`.trace-sr`). */}
        {running || failed ? (
          <span className="trace-status">
            {status}
            {/* 도는 단계는 경과가 붙는다 — 30초째 도는 Bash 와 방금 시작한
                Bash 가 같은 얼굴이면 멈춘 것인지 판단할 근거가 없다. */}
            {running ? <TraceElapsed since={tool.startedAt} /> : null}
          </span>
        ) : (
          <span className="trace-sr">{status}</span>
        )}
        {/* 접혀 있고 더 있으면 얼마나 더 있는지. 펼치기 전에 "이걸 펼칠 가치가
            있나"를 판단할 유일한 근거다. */}
        {!open && peek.hidden > 0 ? (
          <span className="trace-count">{t("acp.tool.moreLines", { n: peek.hidden })}</span>
        ) : null}
        {/* 캐럿은 없어도 **자리는 지킨다** — 캐럿 유무에 따라 오른쪽 열이
            들쭉날쭉하면 스무 줄이 줄맞춤을 잃는다. */}
        <ChevronDown size={12} className={"trace-caret" + (expandable ? "" : " ghost")} />
      </button>
      {open ? (
        <div className="trace-body">
          {tool.input ? <TraceIo tag="IN" text={tool.input} /> : null}
          {/* 편집 도구의 본론 — 무엇이 어떻게 바뀌었나. */}
          {tool.diffs?.length ? <AcpDiffView diffs={tool.diffs} /> : null}
          {tool.output ? <TraceIo tag="OUT" text={tool.output} /> : null}
          {/* 어휘가 틀린 날의 도망갈 데 — 늘 맨 아래에 있다 ({#raw-rail}). */}
          <RawRail raw={raw} />
        </div>
      ) : tool.diffs?.length ? (
        // 접힌 편집 카드는 diff 머리를 보여 준다 — 텍스트 미리보기와 같은 이유,
        // 같은 동작(누르면 펼침).
        <div
          className="trace-peek"
          aria-hidden="true"
          onClick={() => {
            if (window.getSelection()?.toString()) return;
            setChoice(true);
          }}
        >
          <AcpDiffView diffs={tool.diffs} compact />
        </div>
      ) : peek.empty ? null : (
        // 미리보기도 누르면 펼쳐진다 — 잘린 글을 보고 손이 가는 자리가 여기다.
        // 줄과 **같은 동작**을 하므로 보조기기에는 하나만 보이게 감춘다.
        <div
          className={"trace-peek" + (peek.truncated ? " clipped" : "") + (failed ? " failed" : "")}
          aria-hidden="true"
          // 글자를 끌어 고르고 손을 뗀 것도 클릭이다 — 오류 메시지를 복사하려던
          // 참에 블록이 펼쳐지며 자리가 밀리면 고른 것이 어디 갔는지 잃는다.
          onClick={() => {
            if (window.getSelection()?.toString()) return;
            setChoice(true);
          }}
        >
          {peek.input?.text ? (
            <div className="trace-io">
              <span className="trace-io-tag">IN</span>
              <pre>{peek.input.text}</pre>
            </div>
          ) : null}
          {peek.output?.text ? (
            <div className="trace-io">
              <span className="trace-io-tag">OUT</span>
              <pre>{peek.output.text}</pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
