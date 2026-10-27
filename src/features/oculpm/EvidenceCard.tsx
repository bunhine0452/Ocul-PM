import { ShieldCheck } from "@/components/Icons";
import { useT } from "@/i18n";

/**
 * 증거 카드 — 일지 머리글 바로 아래, 접히지 않는다 (best-results UI 라운드).
 *
 * 등급(0·1·2)은 캐시 투영이 `oculpm/evidence.rs` 로 매긴 것이고, 이 카드는 그
 * 근거가 된 「## 검증」 칸의 줄을 그대로 보여 준다 — 「증거 있음」 배지만 보면
 * 무엇이 증거였는지 모른다. 사람 확인(체크)과는 다른 사실이라 같은 칸에 묶지
 * 않는다.
 */
// i18n-ignore-next-line -- 일지 본문의 섹션 헤더를 찾는 정규식 (표시 문자열 아님)
const HEADER = /^#{2,4}\s*(검증|Verification)\b/m;
const NEXT = /^#{1,4}\s/m;

export function verificationLines(body: string): string[] {
  const m = HEADER.exec(body);
  if (!m) return [];
  const rest = body.slice(m.index + m[0].length);
  const end = NEXT.exec(rest);
  const section = end ? rest.slice(0, end.index) : rest;
  return section
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 8);
}

export function EvidenceCard({
  body,
  level,
  entryType,
}: {
  body: string;
  level: number;
  entryType: string;
}) {
  const { t } = useT();
  const judged = entryType === "bug" || entryType === "feature" || entryType === "refactor";
  // 증거를 요구하지 않는 유형(error·chore)은 칸이 있을 때만 — 없는 것을 꾸짖지 않는다.
  if (!judged && level === 0) return null;
  const lines = verificationLines(body);
  const title = level === 2 ? t("entry.evidenceCard.title2") : level === 1 ? t("entry.evidenceCard.title1") : t("entry.evidenceCard.title0");
  const pill = level === 2 ? t("entry.evidence.command") : level === 1 ? t("entry.evidence.section") : t("entry.evidence.none");
  const hint = level === 2 ? t("entry.evidenceCard.hint2") : level === 1 ? t("entry.evidenceCard.hint1") : t("entry.evidenceCard.hint0");
  return (
    <section className="entry-evidence-card" data-level={level} aria-label={t("entry.evidenceCard.aria")}>
      <div className="ev-head">
        <span className="ev-pill">
          <ShieldCheck size={11} />
          {pill}
        </span>
        <span>{title}</span>
      </div>
      {lines.length > 0 ? <pre className="ev-lines">{lines.join("\n")}</pre> : null}
      <span className="ev-hint">{hint}</span>
    </section>
  );
}
