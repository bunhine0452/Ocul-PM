import { useT } from "@/i18n";
import type { ProjectTerms } from "./status";

/** 프로젝트 목록 한 줄의 터미널 표시 — 실행 중인 세션 수, 내 손을 기다리면 「내 차례」. */
export function TermsChip({ terms }: { terms: ProjectTerms | undefined }) {
  const { t } = useT();
  if (!terms) return null;
  return (
    <span className="chip sm" title={t("terminal.sum.title", { n: terms.alive })}>
      {terms.waiting > 0 ? t("terminal.sum.waiting") : t("terminal.sum.running", { n: terms.alive })}
    </span>
  );
}
