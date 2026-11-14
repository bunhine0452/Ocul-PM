/**
 * 설정 · 모양 — 모양(시스템 · 라이트 · 다크) · 글자 크기 · 앱 아이콘. 셋 다 앱 전역(SQLite)이라 창마다 같다.
 *
 * 모양은 세 가지뿐이다. 3.x 의 테마 프리셋·가져오기는 걷었다 — 프리셋을 쓰던 사람은 여기서 아무것도
 * 골라져 있지 않게 보이고, 하나를 누르면 그것이 된다. 글자 크기는 웹뷰 줌(`uiScale`)이라 픽셀을 재는
 * 화면도 같이 커진다. 앱 아이콘(11-04, macOS) — 변형 아홉(`AppIconPicker`). 고르면 백엔드가 Dock 과 번들
 * 아이콘을 바로 바꾼다(`app_icon.rs`).
 *
 * 11-15 (#settings-status): 언어 · 파일 열기는 모양이 아니라 앱의 동작이라 앱 칸으로 옮겼다.
 */
import { useSettings } from "@/contexts/SettingsContext";
import { useT } from "@/i18n";
import { isMac } from "@/lib/platform";
import type { Theme } from "@/lib/settings";
import { AppIconPicker } from "./AppIconPicker";
import { useSaveSetting } from "./saveSetting";
import { PrefsCard, PrefsRow, PrefsSeg } from "./prefsUi";

const SCALES = ["0.9", "1", "1.1", "1.25"] as const;
type Scale = (typeof SCALES)[number];
type Brightness = Extract<Theme, "system" | "light" | "dark">;

/** 저장된 배율에 가장 가까운 단 — 슬라이더 시절의 1.05 같은 값도 하나는 골라져 보인다. */
export function nearestScale(value: number): Scale {
  let best: Scale = "1";
  for (const s of SCALES) {
    if (Math.abs(Number(s) - value) < Math.abs(Number(best) - value)) best = s;
  }
  return best;
}

export function DisplaySection({ id, arrived }: { id: string; arrived?: number }) {
  const { t } = useT();
  const { settings } = useSettings();
  const save = useSaveSetting();
  const brightness: Brightness | null =
    settings.theme === "system" || settings.theme === "light" || settings.theme === "dark" ? settings.theme : null;

  return (
    <PrefsCard id={id} title={t("prefs.display.title")} arrived={arrived}>
      <PrefsRow label={t("prefs.display.brightness")}>
        <PrefsSeg<Brightness>
          label={t("prefs.display.brightness")}
          value={brightness}
          options={[
            { id: "system", label: t("prefs.display.system") },
            { id: "light", label: t("prefs.display.light") },
            { id: "dark", label: t("prefs.display.dark") },
          ]}
          onChange={(next) => save("theme", next)}
        />
      </PrefsRow>
      <PrefsRow label={t("prefs.display.textSize")}>
        <PrefsSeg<Scale>
          label={t("prefs.display.textSize")}
          value={nearestScale(settings.uiScale)}
          options={SCALES.map((s) => ({ id: s, label: `${Math.round(Number(s) * 100)}%` }))}
          onChange={(next) => save("uiScale", Number(next))}
        />
      </PrefsRow>
      {isMac() ? (
        <PrefsRow label={t("prefs.display.appIcon")} meta={t("prefs.display.appIconMeta")}>
          <AppIconPicker value={settings.appIcon} onChange={(next) => save("appIcon", next)} />
        </PrefsRow>
      ) : null}
    </PrefsCard>
  );
}
