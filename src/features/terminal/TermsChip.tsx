import { useT } from "@/i18n";
import type { ProjectTerms } from "./status";

/**
 * 프로젝트 목록 한 줄의 터미널 표시 — 내 손을 기다리면 「내 차례」, 그 창을 본 뒤로 Claude 가 끝냈으면
 * 「새 소식」(읽지 않음, 그 창이 앞에 오면 사라진다), 아니면 실행 중인 세션 수.
 */
export function TermsChip({ terms }: { terms: ProjectTerms | undefined }) {
  const { t } = useT();
  if (!terms) return null;
  if (terms.waiting > 0) return <span className="chip sm">{t("terminal.sum.waiting")}</span>;
  if (terms.unseen) {
    return (
      <span className="chip sm" title={t("terminal.sum.unseenTitle")}>
        <span className="terms-unseen" aria-hidden="true" />
        {t("terminal.sum.unseen")}
      </span>
    );
  }
  return (
    <span className="chip sm" title={t("terminal.sum.title", { n: terms.alive })}>
      {t("terminal.sum.running", { n: terms.alive })}
    </span>
  );
}
