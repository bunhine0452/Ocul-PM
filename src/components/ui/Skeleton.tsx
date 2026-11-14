/**
 * Skeleton — 콘텐츠 형태 로딩 플레이스홀더 (v2 U2, docs/20260706_v2/01-ux-spec.md §2).
 *
 * 전역 `.skel` (primitives.css) 을 사용한다 — 멈춰 있는 면 한 벌(11-15, 숨쉬기는 걷었다).
 * 사용 구분: 목록/카드처럼 "곧 채워질 모양"이 있는 곳은 Skeleton, 모양을 예측할 수 없는
 * 자리는 `LoadingState`(300ms 뒤의 정지 글자).
 */

import { useT } from "@/i18n";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ width, height = 14, className, style }: SkeletonProps) {
  return (
    <div
      className={"skel" + (className ? ` ${className}` : "")}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}

/** 리스트/타임라인용 — 행 여러 개를 세로로 쌓는다. */
export function SkeletonList({
  rows = 3,
  height = 64,
  gap = 12,
}: {
  rows?: number;
  height?: number;
  gap?: number;
}) {
  const { t } = useT();
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap }}
      role="status"
      aria-label={t("common.loading")}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </div>
  );
}
