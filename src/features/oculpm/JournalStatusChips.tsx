import type { Dispatch, SetStateAction } from "react";
import { useT } from "@/i18n";

/**
 * 일지 툴바의 상태 칩 셋 — 「미완」·「확인됨」·「미검토」.
 *
 * `JournalScreenV2` 가 800줄 래칫에 닿아 갈라 낸 조각(journal-scale-round).
 * 상태는 화면이 소유하고(의도적으로 비영속 — 어제 걸어 둔 필터가 오늘 일지를
 * 가리는 착각을 막는다) 여기는 그리기와 상호 배타 규칙만 안다: 「확인됨」과
 * 「미검토」는 둘 다 켜면 결과가 늘 비므로 서로를 끈다.
 */
export function JournalStatusChips({
  unfinishedOnly,
  verifiedOnly,
  unverifiedOnly,
  setUnfinishedOnly,
  setVerifiedOnly,
  setUnverifiedOnly,
}: {
  unfinishedOnly: boolean;
  verifiedOnly: boolean;
  unverifiedOnly: boolean;
  setUnfinishedOnly: Dispatch<SetStateAction<boolean>>;
  setVerifiedOnly: Dispatch<SetStateAction<boolean>>;
  setUnverifiedOnly: Dispatch<SetStateAction<boolean>>;
}) {
  const { t } = useT();
  const chip = (on: boolean) => "scope-chip" + (on ? " on" : "");
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <button
        type="button"
        className={chip(unfinishedOnly)}
        style={{ height: 28 }}
        onClick={() => setUnfinishedOnly((v) => !v)}
        title={t("journal.filterOpenTitle")}
      >
        {t("journal.filterOpen")}
      </button>
      <button
        type="button"
        className={chip(verifiedOnly)}
        style={{ height: 28 }}
        onClick={() =>
          setVerifiedOnly((v) => {
            const next = !v;
            if (next) setUnverifiedOnly(false);
            return next;
          })
        }
        title={t("journal.filterVerifiedTitle")}
      >
        {t("journal.filterVerified")}
      </button>
      <button
        type="button"
        className={chip(unverifiedOnly)}
        style={{ height: 28 }}
        onClick={() =>
          setUnverifiedOnly((v) => {
            const next = !v;
            if (next) setVerifiedOnly(false);
            return next;
          })
        }
        title={t("journal.filterUnverifiedTitle")}
      >
        {t("journal.filterUnverified")}
      </button>
    </div>
  );
}
