import { useDensity } from "@/hooks/useDensity";
import { useT } from "@/i18n";
import { kbd } from "@/lib/kbd";
import type { UiDensity } from "@/lib/density";
import { Section } from "./ui";

/**
 * 설정 「표시」 — 밀도 하나. 두 선택지 각각에 "누구를 위한 것인가" 한 줄을 붙인다.
 * 토글은 툴바에도 있으니 여기는 설명이 있는 자리다.
 */
export function DensitySection() {
  const { density, set } = useDensity();
  const { t } = useT();
  const options: Array<{ id: UiDensity; label: string; hint: string }> = [
    { id: "simple", label: t("density.simple"), hint: t("settings.density.simpleHint") },
    { id: "pro", label: t("density.pro"), hint: t("settings.density.proHint") },
  ];
  return (
    <Section title={t("settings.density.title")} description={t("settings.density.desc", { kbd: kbd("⌘.") })}>
      <div className="cfg-choices" role="radiogroup" aria-label={t("settings.density.title")}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={density === o.id}
            className="cfg-choice"
            onClick={() => set(o.id)}
            title={o.hint}
          >
            <span>{o.label}</span>
          </button>
        ))}
      </div>
      <p className="cfg-field-hint">{density === "pro" ? t("settings.density.proHint") : t("settings.density.simpleHint")}</p>
    </Section>
  );
}
