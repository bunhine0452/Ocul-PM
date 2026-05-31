import { Sidebar } from "@/components/Sidebar";
import { Toolbar } from "@/components/Toolbar";
import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/lib/theme";

// The 5 token/layer stylesheets. This static import is the token-isolation
// mechanism (PR-UI 0 §0.6): App lazy-loads ShellV2 via React.lazy, so Vite
// emits this CSS as a SEPARATE chunk that the browser fetches only when the
// ui_v2 shell first mounts. flag-off never loads the ShellV2 chunk → the new
// --accent (green) never reaches the legacy cream UI. (Verified in PR-UI 1:
// the build emits a distinct ShellV2 CSS chunk; the main bundle keeps only the
// legacy tokens.)
import "@/styles/index.css";

// Final UI Update (ui_v2) — the new 248px-sidebar shell. Mounted by App ONLY
// when isUiV2Enabled() is true. No ui_v2 class name collides with legacy
// (verified PR-UI 1).

const VIEW_META: Record<UiV2View, { title: string; sub?: string; pr: string }> = {
  today: { title: "Today", pr: "PR-UI 2" },
  journal: { title: "작업 일지", pr: "PR-UI 3" },
  diff: { title: "변경 diff", pr: "PR-UI 4" },
  planner: { title: "Planner", pr: "PR-UI 5" },
  search: { title: "시맨틱 코드 검색", pr: "PR-UI 5" },
  terminal: { title: "터미널", pr: "PR-UI 5" },
  ai: { title: "AI 패널", pr: "PR-UI 5" },
  settings: { title: "설정", pr: "PR-UI 6" },
};

interface ShellV2Props {
  projectName: string | null;
  projectRoot: string | null;
  /** Opens the project switcher. PR-UI 1 routes this to the dashboard picker. */
  onOpenProjectSwitcher: () => void;
}

export default function ShellV2({ projectName, projectRoot, onOpenProjectSwitcher }: ShellV2Props) {
  const { state, setUiV2View } = useWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  const view = state.uiV2View;
  const isDark = resolvedTheme === "dark";

  // macOS uses titleBarStyle "Overlay" (src-tauri/src/lib.rs) — the native
  // traffic lights float over the top-left. With the legacy TitleBar gone in
  // ui_v2, the sidebar must reserve a top strip so the brand clears them.
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  const meta = VIEW_META[view];

  return (
    <div className="app" style={{ height: "100%" }}>
      <Sidebar
        view={view}
        onNavigate={setUiV2View}
        projectName={projectName}
        projectPath={projectRoot}
        onOpenProjectSwitcher={onOpenProjectSwitcher}
        isDark={isDark}
        onToggleTheme={() => setTheme(isDark ? "light" : "dark")}
        macTopInset={isMac ? 22 : 0}
      />
      <main className="content">
        <Toolbar title={meta.title} sub={meta.sub} />
        <div className="scroll">
          <div className="page fade-in">
            <div className="empty-hint">
              '{meta.title}' 화면은 {meta.pr} 에서 채워집니다.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
