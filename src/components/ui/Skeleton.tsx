/**
 * Skeleton — 콘텐츠 형태 로딩 플레이스홀더 (v2 U2, docs/20260706_v2/01-ux-spec.md §2).
 *
 * screens.css 의 기존 `.skel` shimmer 를 사용한다 (정의만 있고 미사용이던 것을
 * 승격). reduced-motion 에서는 shimmer 가 꺼지고 정적 면으로 남는다.
 * 스피너(OculSpinner)와의 사용 구분: 목록/카드처럼 "곧 채워질 모양"이 있는 곳은
 * Skeleton, 모양을 예측할 수 없는 단발 작업(재인덱싱 등)은 스피너.
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
