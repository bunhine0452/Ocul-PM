// 코드 맵 탭 — 그래프 렌더 설정.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useSettings } from "@/contexts/SettingsContext";
import { useT } from "@/i18n";
import { Section, Field, Toggle, NumberSlider } from "./ui";

export function GraphTab() {
  const { t } = useT();
  const { settings, set } = useSettings();
  return (
    <Section title={t("settings.graph.title")}>
      <Toggle
        checked={settings.graphShowIsolated}
        onChange={(v) => set("graphShowIsolated", v)}
        label={t("settings.graph.showIsolated")}
      />
      <Field
        label={t("settings.graph.threshold", { n: settings.graphGroupThreshold })}
        hint={t("settings.graph.thresholdHint")}
      >
        <NumberSlider
          ariaLabel={t("settings.graph.threshold", { n: settings.graphGroupThreshold })}
          value={settings.graphGroupThreshold}
          min={2}
          max={12}
          onChange={(v) => set("graphGroupThreshold", v)}
        />
      </Field>
    </Section>
  );
}
