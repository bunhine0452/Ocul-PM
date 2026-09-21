import { useMemo, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { isConfirmed } from "./verified";
import type { JournalEntrySummary } from "@/lib/bindings";

// review-queue round — 「미검토」 필터가 켜졌을 때만 목록 위에 뜨는 손잡이.
// `.jl-notice` 를 그대로 쓴다 (상한 고지·출처 레일과 같은 자리, 같은 모양).
//
// 건수 둘을 가른다: `total` 은 **이 필터로 백엔드가 센 전체**(`matchTotal`),
// `shown` 은 지금 화면에 그려진(추가 검색·종류 칩까지 통과한) 것 — 상한 고지와
// 같은 이유로 두 수가 다를 수 있다.

interface ReviewQueueBarProps {
  projectId: number;
  /** 백엔드가 `unverified_only` 로 센 전체 건수. 아직 안 왔으면 null. */
  total: number | null;
  /** 지금 화면에 그려진 일지 — 부모는 「미검토」 필터가 켜졌을 때만 이 바를
   *  마운트하므로 전부 미검토겠지만, `isConfirmed` 로 한 번 더 거른다. */
  entries: JournalEntrySummary[];
  /** 벌크 확인이 끝난 뒤 목록을 다시 불러오라는 신호. */
  onConfirmed: () => void;
}

export function ReviewQueueBar({ projectId, total, entries, onConfirmed }: ReviewQueueBarProps) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const visiblePaths = useMemo(
    () => entries.filter((e) => !isConfirmed(e)).map((e) => e.relative_path),
    [entries],
  );
  const shown = visiblePaths.length;

  const confirmAll = async () => {
    if (busy || shown === 0) return;
    setBusy(true);
    try {
      const report = await oculpmApi.setJournalVerifiedBulk(projectId, visiblePaths, true);
      toast.info(t("journal.reviewQueue.confirmedToast", { n: report.updated }));
      onConfirmed();
    } catch (e) {
      toast.destructive(
        t("journal.reviewQueue.confirmFailed", {
          error: e instanceof OculpmApiError ? e.message : String(e),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="jl-notice">
      <span>{t("journal.reviewQueue.summary", { total: total ?? shown, shown })}</span>
      <button
        type="button"
        className="btn sm"
        {...blocked(shown === 0 ? t("journal.reviewQueue.nothingToConfirm") : null)}
        disabled={busy}
        onClick={() => void confirmAll()}
      >
        {busy ? t("journal.reviewQueue.confirming") : t("journal.reviewQueue.confirmAll")}
      </button>
    </div>
  );
}
