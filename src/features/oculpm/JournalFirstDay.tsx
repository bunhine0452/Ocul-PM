/**
 * 일지가 하나도 없을 때의 작업 일지 화면 — 문장 하나 · 채운 단추 하나 (화면 검사 #empty-one).
 *
 * 11-23 G2: 정말 처음인 프로젝트의 채운 단추는 오늘 화면 「첫 기록까지 세 걸음」 의 2단계와 같은 「터미널에서 첫 작업
 * 맡기기」 다 — 같은 프롬프트(`today.first.step2Prompt`), 같은 문장(3단계 `today.first.step3Body`). 어느 탭에서 시작해도
 * 같은 첫걸음이다. 예전엔 「커밋에서 일지 만들기」(손으로 메우는 길)가 채운 단추라, 기록이 저절로 쌓이는 흐름보다
 * 되짚어 채우는 길이 먼저 보였다 — 그 단추는 보통 단추로 곁에 남는다. 예전 기록이 있으면(최근 14일만 빈 것) 그리로.
 */
import { useState } from "react";

import { toAppError } from "@/api/invoke";
import { EmptyState } from "@/components/EmptyState";
import { runPromptInTerminal } from "@/features/terminal/runPrompt";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toast } from "@/lib/toast";

export function JournalFirstDay({
  projectId,
  hasOlder,
  onShowAll,
  backfilling,
  onBackfill,
}: {
  projectId: number;
  hasOlder: boolean;
  onShowAll: () => void;
  backfilling: boolean;
  onBackfill: () => void;
}) {
  const { t } = useT();
  const [starting, setStarting] = useState(false);

  if (hasOlder) {
    return (
      <EmptyState
        density="rich"
        actions={
          <button type="button" className="btn primary" onClick={onShowAll}>
            {t("journal.loadMore")}
          </button>
        }
      >
        {t("journal.emptyRecent")}
      </EmptyState>
    );
  }

  const startFirst = () => {
    setStarting(true);
    runPromptInTerminal(projectId, t("today.first.step2Prompt"))
      .catch((e: unknown) => toast.destructive(t("terminal.openFailed", { error: tError(toAppError(e)) })))
      .finally(() => setStarting(false));
  };

  return (
    <EmptyState
      density="rich"
      actions={
        <>
          <button type="button" className="btn primary" disabled={starting} onClick={startFirst}>
            {starting ? t("today.busy.opening") : t("journal.firstTask")}
          </button>
          <button type="button" className="btn" disabled={backfilling} onClick={onBackfill}>
            {backfilling ? t("journal.backfill.busy") : t("journal.backfill.action")}
          </button>
        </>
      }
    >
      {t("today.first.step3Body")}
    </EmptyState>
  );
}
