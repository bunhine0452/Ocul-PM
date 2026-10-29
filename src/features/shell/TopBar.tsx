import type { Ref } from "react";
import { SettingsIcon } from "@/components/Icons";
import { FindButton } from "@/components/Toolbar";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { ProjectSwitcher } from "@/features/shell/ProjectSwitcher";
import type { NavBadges } from "@/features/shell/useNavBadges";
import { NAV_ENTRIES, navShortcutLabel } from "@/lib/navRegistry";
import { useT } from "@/i18n";
import type { Project } from "@/lib/bindings";
import { kbd } from "@/lib/kbd";
import { dragRegion } from "@/lib/platform";

// 셸 윗줄 (4.0) — 사이드바를 걷고 한 줄에 모은다.
//
//   [신호등 자리] 프로젝트 ▾ · 오늘 · 작업 일지 · 계획 · 변경 ···· [화면 동작] 찾기 ⌘K ⚙
//
// 사이드바 옆에 목록 칸(일지 목록 · 계획 목록 · 파일 목록)이 또 서면 왼쪽에 사이드바가 두
// 겹이었다 (사용자 지적 2026-10-29). 화면이 넷이면 탭 한 줄로 충분하고, 그러면 화면마다
// 왼쪽 칸은 많아야 하나다. 화면 제목은 고른 탭이 대신하므로 화면의 `<Toolbar>` 는 제목 없이
// 동작만 이 줄의 「화면 동작」 자리로 보낸다(`ToolbarSlotContext`).
//
// 탭 옆의 수는 **예외만** — 확인할 것(경고색) 하나.

interface TopBarProps {
  view: UiV2View;
  onNavigate: (view: UiV2View) => void;
  projectName: string | null;
  currentProjectId: number | null;
  projects: Project[];
  /** 다른 프로젝트의 창을 연다 (이미 열려 있으면 그 창이 앞으로 — I1). */
  onOpenProject: (projectId: number) => void;
  onProjectsChanged?: () => void;
  badges?: NavBadges;
  /** 화면 동작이 포털될 자리. */
  slotRef: Ref<HTMLDivElement>;
}

export function TopBar({
  view,
  onNavigate,
  projectName,
  currentProjectId,
  projects,
  onOpenProject,
  onProjectsChanged,
  badges,
  slotRef,
}: TopBarProps) {
  const { t } = useT();
  // 빈 자리는 창을 잡는 띠다 — macOS 오버레이 타이틀바에서만 (`dragRegion`).
  const drag = dragRegion();
  return (
    <header className="topbar" {...drag}>
      <ProjectSwitcher
        projectName={projectName}
        currentProjectId={currentProjectId}
        projects={projects}
        onOpenProject={onOpenProject}
        onProjectsChanged={onProjectsChanged}
      />
      <nav className="topnav" aria-label={t("nav.aria.main")}>
        {NAV_ENTRIES.map((e) => {
          const active = view === e.id;
          const label = t(e.labelKey);
          const shortcut = navShortcutLabel(e.id);
          const badge = badges?.[e.id];
          return (
            <button
              key={e.id}
              type="button"
              className={"topnav-item" + (active ? " active" : "")}
              aria-current={active ? "page" : undefined}
              title={shortcut ? `${label} (${shortcut})` : label}
              onClick={() => onNavigate(e.id)}
            >
              <span className="topnav-label">{label}</span>
              {badge ? (
                <span className="nav-badge" aria-label={t("nav.toCheck", { n: badge.n })}>
                  {badge.n}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="topbar-fill" {...drag} />
      <div className="topbar-actions" ref={slotRef} />
      <FindButton />
      <button
        type="button"
        className={"iconbtn topbar-settings" + (view === "settings" ? " active" : "")}
        aria-current={view === "settings" ? "page" : undefined}
        aria-label={t("sidebar.settings")}
        title={`${t("sidebar.settings")} (${kbd("⌘,")})`}
        onClick={() => onNavigate("settings")}
      >
        <SettingsIcon size={15} />
      </button>
    </header>
  );
}
