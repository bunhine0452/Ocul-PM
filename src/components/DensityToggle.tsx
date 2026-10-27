import { useOptionalSettings } from "@/contexts/SettingsContext";
import { useDensity } from "@/hooks/useDensity";
import { useT } from "@/i18n";
import { kbd } from "@/lib/kbd";

/**
 * 「간단 / 전문」 — 모든 화면 툴바의 오른쪽 끝, 같은 자리 (best-results UI 라운드).
 *
 * 설정 프로바이더 밖(단위 테스트·웹 미리보기 일부)에서는 그리지 않는다: 바꿀 수
 * 없는 토글을 보여 주는 것은 거짓말이다.
 */
export function DensityToggle() {
  const ctx = useOptionalSettings();
  const { density, set } = useDensity();
  const { t } = useT();
  if (!ctx) return null;
  return (
    <div className="seg density-seg" role="group" aria-label={t("density.aria")} title={`${t("density.aria")} (${kbd("⌘.")})`}>
      <button
        type="button"
        className="seg-item"
        aria-pressed={density === "simple"}
        onClick={() => set("simple")}
      >
        {t("density.simple")}
      </button>
      <button
        type="button"
        className="seg-item"
        aria-pressed={density === "pro"}
        onClick={() => set("pro")}
      >
        {t("density.pro")}
      </button>
    </div>
  );
}
