/**
 * 「새 일지」 토스트 리스너 — WorkspaceContext 에서 떼어낸 조각 (2026-09-22).
 *
 * 문지기(`journalToastGate`)를 지나 온 것만 띄운다: 재출현한 옛 일지는 건너뛰고,
 * 짧은 창의 폭주는 한 장으로 접는다. 실측: git 체크아웃이 일지 폴더를 되살리자
 * 15초짜리 토스트 18장이 벽처럼 쌓였다.
 *
 * 「열기」 — 이 탭은 숨어 있을 수 있다 (크롬식 탭). 창 전역 `openEntity` 버스는
 * 활성 탭이 받아 **보고 있던 프로젝트의** 일지로 갔다 (2026-09-21) →
 * `lib/entryJump` + 탭 활성화.
 */
import { toAppError } from "@/api/invoke";
import { windowApi } from "@/api/window";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { OculpmJournalAdded } from "@/lib/bindings";
import { requestEntryJump } from "@/lib/entryJump";
import { decideEntryToast } from "@/lib/journalToastGate";
import { toast } from "@/lib/toast";

export function makeJournalAddedListener(
  currentProjectId: () => number | null,
): (evt: { payload: OculpmJournalAdded }) => void {
  const recentShows: number[] = [];
  return (evt) => {
    const projectId = evt.payload.project_id;
    if (projectId !== currentProjectId()) return;
    const relativePath = evt.payload.summary.relative_path;
    const now = Date.now();
    const decision = decideEntryToast(evt.payload.summary.created_at, now, recentShows);
    if (decision === "skip") return;
    if (decision === "fold") {
      toast.info(t("ws.newEntriesBurst"), { dedupKey: "journal_added:burst", dedupWindowMs: 10_000 });
      return;
    }
    recentShows.push(now);
    const open = () => {
      requestEntryJump(projectId, relativePath);
      windowApi.openProjectTab(projectId, null).catch((e) => toast.destructive(tError(toAppError(e))));
    };
    toast.info(t("ws.newEntry", { title: evt.payload.summary.title }), {
      dedupKey: `journal_added:${relativePath}`,
      actions: [{ label: t("ws.openEntry"), onClick: open }],
    });
  };
}
