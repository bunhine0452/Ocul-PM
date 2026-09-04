// 코드 맵 탭 — 그래프 렌더 설정.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useSettings } from "@/contexts/SettingsContext";
import { useT } from "@/i18n";
import { useSaveSetting } from "../saveSetting";
import { useDeferredCommit } from "../useDeferredCommit";
import { Section, Field, Toggle, NumberSlider } from "./ui";

export function GraphTab() {
  const { t } = useT();
  const { settings } = useSettings();
  const save = useSaveSetting();
  // 라벨이 초안을 읽는다 — 드래그 중에도 숫자가 즉시 따라오고, 디스크로 가는
  // 쓰기만 손을 뗀 뒤 한 번이다 (v2.42.0 `{#settings-slider}`).
  const threshold = useDeferredCommit(settings.graphGroupThreshold, (v) =>
    save("graphGroupThreshold", v),
  );
  return (
    <Section title={t("settings.graph.title")}>
      <Toggle
        checked={settings.graphShowIsolated}
        onChange={(v) => save("graphShowIsolated", v)}
        label={t("settings.graph.showIsolated")}
      />
      <Field
        label={t("settings.graph.threshold", { n: threshold.value })}
        hint={t("settings.graph.thresholdHint")}
      >
        <NumberSlider
          ariaLabel={t("settings.graph.threshold", { n: threshold.value })}
          value={threshold.value}
          min={2}
          max={12}
          onChange={threshold.change}
          onCommit={threshold.flush}
        />
      </Field>
    </Section>
  );
}
