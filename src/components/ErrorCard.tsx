import type { CSSProperties } from "react";
import { TriangleAlert } from "@/components/Icons";
import { useT } from "@/i18n";

/**
 * 목록/화면 로드 실패 카드 — 제목 · 원문 오류 · 「다시 시도」.
 *
 * Today · 작업 일지 · 플래너가 같은 마크업을 세 벌 들고 있었고, 논의 · 회고 ·
 * 검색 · 문서 · Diff 는 오류를 글자로만 보여 주고 재시도가 없었다(2026-08-30
 * 감사). 화면이 다르다고 실패의 모양이 달라야 할 이유는 없다 — 한 벌로.
 */
interface ErrorCardProps {
  /** 무엇이 실패했는가 (예: "일지를 불러오지 못했어요"). */
  title: string;
  /** 백엔드 원문. 없으면 제목만. */
  error?: string | null;
  /** 있으면 「다시 시도」 버튼. */
  onRetry?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function ErrorCard({ title, error, onRetry, style, className }: ErrorCardProps) {
  const { t } = useT();
  return (
    <div className={"card card-pad" + (className ? ` ${className}` : "")} role="alert" style={style}>
      <div className="stat-top" style={{ color: "var(--t-bug)" }}>
        <TriangleAlert size={14} /> {title}
      </div>
      {error ? (
        <div className="today-date" style={{ marginTop: 8, wordBreak: "break-word" }}>
          {error}
        </div>
      ) : null}
      {onRetry ? (
        <button type="button" className="btn sm" style={{ marginTop: 12 }} onClick={onRetry}>
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}
