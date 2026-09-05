// {#retro-standing-line} — 회고의 상시 한 줄: 이 기간에 **일지 없이 끝난
// 세션**이 몇 건인가.
//
// 회고의 다른 카드들(EvalTrend·DeferLedger·RuleCandidates)은 재료가 없으면
// 스스로 숨는다. 이 줄만 숨지 않는다 — 숨는 순간 "그 주가 깨끗했다"와
// "그 주의 누락이 판정에 가려졌다"가 화면에서 똑같아지기 때문이다. 회고는
// 한 주를 요약하는 화면이라 그 침묵이 곧 그 주를 실제보다 깨끗하게 보이게
// 한다 (Today 의 자기은닉 카드와 같은 실패 — {#card-unhide}).
//
// 그래서 이 줄은 숫자와 **판정의 한계**를 함께 적는다. 판정은 훅이 남긴
// 세션 종료 신호에서 오고, (a) 훅이 없는 에이전트의 세션은 신호 자체가
// 없으며 (b) 뒤이어 일지가 쓰이면 앞선 신호가 해소로 걷힌다. 0건은
// "확인된 누락 없음"이지 "기록이 완전함"이 아니다.
//
// 백엔드 판정(claude_hooks::journal_missing_signals)은 곧 세션 귀속 기준으로
// 바뀐다 — 그래서 여기서는 응답의 **개수만** 읽는다 (행 모양에 의존 금지).
import { useCallback, useEffect, useState } from "react";

import { NotebookText } from "@/components/Icons";
import { hooksApi } from "@/api/claudeSurface";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";

type State =
  | { kind: "loading" }
  | { kind: "ok"; n: number }
  /** 조회 실패 — 0건과 다르다. "지금은 알 수 없다"고 말해야 한다. */
  | { kind: "failed" };

export function MissingSessionsLine({
  projectId,
  days,
  onNavigate,
}: {
  projectId: number;
  /** 회고 화면이 고른 기간과 같은 창을 본다 (기본 7일 = 이번 주). */
  days: number;
  /** N>0 일 때 Today 의 해당 카드로 보내는 손잡이. */
  onNavigate?: (view: UiV2View) => void;
}) {
  const { t } = useT();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    void hooksApi
      .journalMissing(projectId, days)
      .then((rows) => {
        if (alive) setState({ kind: "ok", n: rows.length });
      })
      // 봉투 오류도 전송 실패도 `call` 이 reject 로 접는다 — 어느 쪽이든
      // "0건"이 아니라 "알 수 없음"이다.
      .catch(() => {
        if (alive) setState({ kind: "failed" });
      });
    return () => {
      alive = false;
    };
  }, [projectId, days, nonce]);

  const retry = useCallback(() => setNonce((x) => x + 1), []);

  return (
    <div className="rounded-lg border border-border/60 bg-card px-3.5 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          <NotebookText size={15} />
        </span>
        <span className="shrink-0 font-semibold text-foreground">
          {t("retro.missing.label")}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground tabular-nums">
          {state.kind === "loading"
            ? t("retro.missing.checking", { days })
            : state.kind === "failed"
              ? t("retro.missing.failed")
              : t("retro.missing.count", { days, n: state.n })}
        </span>
        {state.kind === "failed" ? (
          <button type="button" className="btn sm shrink-0" onClick={retry}>
            {t("common.retry")}
          </button>
        ) : null}
        {state.kind === "ok" && state.n > 0 && onNavigate ? (
          <button
            type="button"
            className="btn sm shrink-0"
            onClick={() => onNavigate("today")}
          >
            {t("retro.missing.goToday")}
          </button>
        ) : null}
      </div>
      {state.kind === "ok" ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {state.n > 0 ? t("retro.missing.someNote") : t("retro.missing.zeroNote")}
        </p>
      ) : null}
    </div>
  );
}
