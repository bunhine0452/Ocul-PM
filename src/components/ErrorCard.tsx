import type { CSSProperties, ReactNode } from "react";
import { TriangleAlert } from "@/components/Icons";
import { useT } from "@/i18n";

/**
 * 목록/화면 로드 실패 카드 — 제목 · 원문 오류 · 「다시 시도」.
 *
 * Today · 작업 일지 · 플래너가 같은 마크업을 세 벌 들고 있었고, 논의 · 회고 ·
 * 검색 · 문서 · Diff 는 오류를 글자로만 보여 주고 재시도가 없었다(2026-08-30
 * 감사). 화면이 다르다고 실패의 모양이 달라야 할 이유는 없다 — 한 벌로.
 *
 * 11-15 — 제목이 본문보다 작았고(12px, --t-bug 3.83:1) 원문이 본문 서체였다. 이제 제목 13/600
 * `--danger-text`, 원문은 기계 글씨(영수증 규칙 2). 렌더 경계(`ErrorBoundary`)도 이 카드다. 모양은
 * primitives.css 「오류 카드」 — 시작 창에서도 뜨므로 전역이다.
 */
interface ErrorCardProps {
  /** 무엇이 실패했는가 (예: "일지를 불러오지 못했어요"). */
  title: string;
  /** 백엔드 원문. 없으면 제목만. */
  error?: string | null;
  /** 있으면 「다시 시도」 버튼. */
  onRetry?: () => void;
  /** 원문 아래의 안내 한 줄 — 다음에 무엇을 하면 되는가(렌더 경계의 「로그를 보내 주세요」). */
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function ErrorCard({ title, error, onRetry, children, style, className }: ErrorCardProps) {
  const { t } = useT();
  return (
    <div className={"card err-card" + (className ? ` ${className}` : "")} role="alert" style={style}>
      <div className="err-title">
        <TriangleAlert size={15} aria-hidden="true" />
        <span>{title}</span>
      </div>
      {error ? <pre className="err-raw">{error}</pre> : null}
      {children ? <p className="err-hint">{children}</p> : null}
      {onRetry ? (
        <button type="button" className="btn sm" onClick={onRetry}>
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}
