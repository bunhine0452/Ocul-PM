/**
 * 시작 창의 설정 (11-15) — 프로젝트를 들이기 전에도 언어 · 밝기 · 편집기를 바꾼다.
 *
 * 셸의 설정 한 쪽(`SettingsPage`)에서 앱 전역의 것만 싣는다. 「이 프로젝트」 칸은 프로젝트 창의 워크스페이스를
 * 읽고, 데이터 칸의 「처음부터 다시 만들기」 는 이 프로젝트의 캐시를 다시 만드는 단추라 프로젝트가 없는 이 창에서는
 * 눌러도 아무 일이 없었다(막다른 단추). 그래서 데이터 칸은 앱 전역 칸(`AppSection` — 언어 · 편집기 · 앱 판 ·
 * 로그 · 앱 캐시 줄이기)을 그대로 쓴다. 프로젝트 캐시 다시 만들기는 「이 프로젝트」 칸에만 있다.
 * 시작 창을 여는 사람 대부분은 설정을 안 열어서 늦게 싣는다(`StartWindow` 의 lazy).
 */
import { AgentsSection } from "@/features/settings/AgentsSection";
import { AppSection } from "@/features/settings/DataSection";
import { DisplaySection } from "@/features/settings/DisplaySection";
import { SECTION_ID } from "@/features/settings/SettingsPage";
import { useT } from "@/i18n";
import "@/features/settings/prefs.css";

export default function StartSettings() {
  const { t } = useT();
  return (
    <div className="prefs start-prefs">
      <h1 className="prefs-h">{t("shell.settings.title")}</h1>
      <AgentsSection id={SECTION_ID.agents} />
      <DisplaySection id={SECTION_ID.display} />
      <AppSection id={SECTION_ID.data} />
    </div>
  );
}
