/**
 * 설정 — **한 쪽** (4.0, 시안 Settings.dc.html).
 *
 * 칸은 넷뿐이다: 에이전트 연결 · 이 프로젝트 · 표시 · 데이터. 3.x 의 탭 열두 개 ·
 * 세로 레일 · 설정 검색 · 색인은 걷었다 — 앱 안 LLM·자동화·선언적 설정·스킬 허브·
 * 테마 갤러리가 사라지자 남는 것이 한 화면에 들어갔고, 한 화면이면 찾을 필요가 없다.
 *
 * 다른 화면의 안내 버튼은 `openSettings("agents" | …)` 로 이 쪽의 칸을 가리킨다 —
 * 마운트 때 대기 중인 칸이 있으면 그리로 스크롤한다.
 */
import { useEffect } from "react";

import { Toolbar } from "@/components/Toolbar";
import { useT } from "@/i18n";
import { consumeSettingsSection, onOpenSettingsRequest, type SettingsSection } from "@/lib/settingsNav";
import { AgentsSection } from "./AgentsSection";
import { DataSection } from "./DataSection";
import { DisplaySection } from "./DisplaySection";
import { ProjectSection } from "./ProjectSection";
import "./prefs.css";

export const SECTION_ID: Record<SettingsSection, string> = {
  agents: "prefs-agents",
  project: "prefs-project",
  display: "prefs-display",
  data: "prefs-data",
};

function scrollTo(section: SettingsSection | null) {
  if (!section) return;
  // 마운트 직후에는 아직 칸이 없다 — 한 프레임 뒤에 찾는다.
  requestAnimationFrame(() => {
    const el = document.getElementById(SECTION_ID[section]);
    el?.scrollIntoView?.({ block: "start" });
  });
}

export function SettingsPage() {
  const { t } = useT();

  useEffect(() => {
    scrollTo(consumeSettingsSection());
    return onOpenSettingsRequest((section) => {
      consumeSettingsSection();
      scrollTo(section);
    });
  }, []);

  return (
    <>
      <Toolbar title={t("shell.settings.title")} sub={t("prefs.sub")} />
      <div className="scroll">
        <div className="page prefs">
          <AgentsSection id={SECTION_ID.agents} />
          <ProjectSection id={SECTION_ID.project} />
          <DisplaySection id={SECTION_ID.display} />
          <DataSection id={SECTION_ID.data} />
        </div>
      </div>
    </>
  );
}
