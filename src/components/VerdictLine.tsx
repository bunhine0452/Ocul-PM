/**
 * 판정 줄 (11-02, Ocul 의 시그니처) — 확인 명령의 결과를 앱 어디서나 **한 모양**으로.
 *
 * 판정은 에이전트의 말이 아니라 명령이 찍은 끝 줄이다. 그래서 그 끝 줄을 고쳐 쓰지 않고 그대로(mono)
 * 앞에 세운다: ✓/✗ · 끝 줄 · 오른쪽 시각, 필요하면 아래 한 줄(명령 · 계획). 영수증 규칙(11-04):
 * 통과는 회색으로 조용하고, 실패(빨강 ✗) · 통과 뒤 바뀜(호박 ✓ — 기록된 판정은 ✓ 그대로, 그 뒤에
 * 파일이 바뀌었다)만 색이 든다. 옛 왼쪽 2px 색 선은 걷었다.
 * 오늘 「먼저 볼 것」 · 계획 판정 칸 · 계획 목록이 같은 것을 쓴다 — 고르면 사용자가 한 번 배운다.
 */
import type { ReactNode } from "react";

import { useT } from "@/i18n";
import "./verdictLine.css";

/** `away` — ✓ 가 다른 OS 에서 돌았고 이 기기에서는 아직이다 (11-13). 모양은 `stale` 과 같다(호박 ✓). */
export type VerdictState = "pass" | "fail" | "stale" | "away";

const WORD = { pass: "verdict.pass", fail: "verdict.fail", stale: "verdict.stale", away: "verdict.away" } as const;

export function VerdictLine({
  state,
  summary,
  when,
  sub,
  compact = false,
  bare = false,
}: {
  state: VerdictState;
  /** 결과 끝 줄 그대로 — 비었으면 「끝 줄 없음」. */
  summary: string;
  /** 사람이 읽는 시각(「3시간 전」). */
  when?: string;
  /** 아래 한 줄 — 명령 · 계획 · 바뀐 파일. compact 면 그리지 않는다. */
  sub?: ReactNode;
  /** 목록 한 줄 — 아래 줄 없이 작게. */
  compact?: boolean;
  /** 표시(✓/✗)를 그리지 않는다 — 앞에 같은 뜻의 상태 칩이 이미 선 행. 읽기 낱말은 남긴다. */
  bare?: boolean;
}) {
  const { t } = useT();
  return (
    <div className={`vl is-${state}${compact ? " is-compact" : sub ? " has-sub" : ""}${bare ? " is-bare" : ""}`}>
      {bare ? null : (
        <span className="vl-mark" aria-hidden="true">
          {state === "fail" ? "✗" : "✓"}
        </span>
      )}
      <span className="vl-out" title={summary || undefined}>
        <span className="vl-sr">{t(WORD[state])} </span>
        {summary || <span className="vl-empty">{t("today.check.noSummary")}</span>}
      </span>
      {when ? <span className="vl-when">{when}</span> : null}
      {sub && !compact ? <div className="vl-sub">{sub}</div> : null}
    </div>
  );
}
