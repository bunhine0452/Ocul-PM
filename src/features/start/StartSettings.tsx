/**
 * 시작 창의 설정 (11-15) — 프로젝트를 들이기 전에도 언어 · 밝기 · 편집기를 바꾼다.
 *
 * 셸의 설정 한 쪽(`SettingsPage`)에서 「이 프로젝트」 칸만 뺀 것이다 — 그 칸은 프로젝트 창의 워크스페이스를
 * 읽고, 시작 창엔 프로젝트가 없다. 나머지 셋(에이전트 연결 · 표시 · 데이터)은 앱 전역이라 그대로 쓴다.
 * 시작 창을 여는 사람 대부분은 설정을 안 열어서 늦게 싣는다(`StartWindow` 의 lazy).
 */
import { AgentsSection } from "@/features/settings/AgentsSection";
import { DataSection } from "@/features/settings/DataSection";
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
      <DataSection id={SECTION_ID.data} />
    </div>
  );
}
