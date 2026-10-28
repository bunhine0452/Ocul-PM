import { ChevronRight } from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { useDensity } from "@/hooks/useDensity";
import { useT } from "@/i18n";
import { kbd } from "@/lib/kbd";
import type { UiDensity } from "@/lib/density";
import { reportRejection } from "@/lib/reportFailure";
import { Section, Toggle } from "./ui";

/**
 * 설정 「표시」 — 밀도 하나, 그 밖에 둘 (UI 밀도 라운드 3, 시안 F). 베타 화면 스위치는 보류 등급
 * 화면과 함께 걷었다 (2026-10-28, simplify-round).
 *
 * 밀도는 두 선택지 각각에 "누구를 위한 것인가" 한 줄.
 */

export function DensitySection() {
  const { density, set } = useDensity();
  const { settings, set: save } = useSettings();
  const { t } = useT();
  const options: Array<{ id: UiDensity; label: string; hint: string; tag?: string }> = [
    { id: "simple", label: t("density.simple"), hint: t("settings.density.simpleHint"), tag: t("settings.density.defaultTag") },
    { id: "pro", label: t("density.pro"), hint: t("settings.density.proHint") },
  ];
  return (
    <>
      <Section title={t("settings.density.title")} description={t("settings.density.desc", { kbd: kbd("⌘.") })}>
        <div className="cfg-density" role="radiogroup" aria-label={t("settings.density.title")}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={density === o.id}
              className={"cfg-density-opt" + (density === o.id ? " on" : "")}
              onClick={() => set(o.id)}
            >
              <span className="cfg-density-dot" aria-hidden="true" />
              <span className="cfg-density-text">
                <b>
                  {o.label}
                  {o.tag ? <i>{o.tag}</i> : null}
                </b>
                <span>{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>


      <Section title={t("settings.misc.title")}>
        <Toggle
          checked={settings.kbdHints}
          onChange={(v) => reportRejection(save("kbdHints", v), "settings.saveFailed")}
          label={t("settings.misc.kbdHints")}
          hint={t("settings.misc.kbdHintsHint")}
        />
        <button
          type="button"
          className="cfg-toggle cfg-jump"
          onClick={() => document.getElementById("cfg-theme")?.scrollIntoView({ block: "start", behavior: "smooth" })}
        >
          <span className="cfg-toggle-text">
            {t("settings.misc.theme")}
            <p className="cfg-field-hint">{t("settings.misc.themeHint")}</p>
          </span>
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      </Section>
    </>
  );
}
