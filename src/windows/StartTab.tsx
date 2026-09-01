/**
 * 시작 탭 — Chrome 의 "새 탭 페이지"에 해당하는 프로젝트 메인 화면.
 *
 * 프로젝트 목록·추가·이름 변경·제거·인덱싱과 그린필드 마법사를 담당하고,
 * 프로젝트를 고르면 **이 탭이 그 자리에서 프로젝트 탭이 된다**
 * (`set_tab_project`) — 새 탭이 생기지 않는 게 Chrome 과 같은 점이다.
 * 단, 그 프로젝트가 이미 다른 탭에 열려 있으면 백엔드가 그쪽을 활성화한다(I1).
 *
 * `WorkspaceProvider` 를 마운트하지 않는다 — 워크스페이스 상태(현재 화면·
 * 터미널 탭·필터)는 프로젝트 탭의 개념이고, 시작 탭이 쓰기를 하지 않는 덕분에
 * 탭 사이 localStorage 충돌이 구조적으로 사라진다.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import {
  commands,
  type Project,
  type IndexProgress,
  type ProjectBlueprint,
} from "@/lib/bindings";

import { CommandPalette } from "@/components/CommandPalette";
import { StartScreen } from "@/features/onboarding/StartScreen";
// 그린필드 마법사는 새 프로젝트를 만들 때만 쓴다 — 시작 탭의 첫 그림엔 없다.
// 정적 import 가 마법사(+ 템플릿·검증 단계)를 진입 청크에 얹고 있었다
// (완성도 감사 2026-08-30 #lazy-restore).
const GreenfieldWizard = lazy(() =>
  import("@/features/onboarding/GreenfieldWizard").then((m) => ({ default: m.GreenfieldWizard })),
);
// 첫 실행 마법사도 같은 이유로 지연 로드다 — 설치하고 처음 켠 **한 번**만
// 쓰이는 화면이 매 실행의 진입 청크에 실릴 이유가 없다.
const WelcomeWizard = lazy(() =>
  import("@/features/onboarding/WelcomeWizard").then((m) => ({ default: m.WelcomeWizard })),
);
import { shouldOpenWelcome } from "@/features/onboarding/welcomeGate";
import { SettingsOverlay } from "@/windows/SettingsOverlay";
import { Dialog } from "@/windows/Dialog";

import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useSettings } from "@/contexts/SettingsContext";
import { useT } from "@/i18n";
import { toast } from "@/lib/toast";
import { AppearancePicker } from "@/features/onboarding/home/AppearancePicker";
import { ProjectThemePicker } from "@/features/theme/ProjectThemePicker";
import { themesApi } from "@/api/themes";
import { toAppError } from "@/api/invoke";
import { tError } from "@/i18n/errors";
import {
  resolveProjectColor,
  resolveProjectIcon,
  type ProjectColorId,
} from "@/features/onboarding/home/projectAppearance";

export interface StartTabProps {
  /** 이 탭의 id — 프로젝트를 고르면 이 탭이 제자리에서 승격한다. */
  tabId: number;
  /** 화면에 보이는 탭인가 — 단축키·팔레트는 활성 탭만 듣는다. */
  active: boolean;
  /** 어디든 탭으로 열려 있는 프로젝트 id — 카드의 "열림" 배지. */
  openProjects: number[];
}

export default function StartTab({ tabId, active, openProjects }: StartTabProps) {
  const { t } = useT();
  const { settings, loaded: settingsLoaded } = useSettings();

  const [projects, setProjects] = useState<Project[]>([]);
  /** 첫 목록 조회가 끝났나 — 조회 전의 빈 배열을 "프로젝트 0개"로 오해하면
   *  이미 쓰던 사용자에게 첫 실행 마법사가 번쩍인다. */
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexingId, setIndexingId] = useState<number | null>(null);
  /** 첫 실행 마법사가 떠 있나 (아래 effect 가 한 번만 켠다). */
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  // Project lifecycle dialogs
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [newName, setNewName] = useState("");
  // 편집 다이얼로그의 겉모습 초안. 저장 전까지는 카드에 반영하지 않는다.
  const [draftIcon, setDraftIcon] = useState("folder");
  const [draftColor, setDraftColor] = useState<ProjectColorId>("green");
  /** 이 프로젝트에 묶인 테마 (`null` = 전역 설정 따름). */
  const [draftTheme, setDraftTheme] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  // Opt-in: independently wipe Ocul-PM's on-disk artifacts from the project
  // folder when removing. Both reset every time the dialog opens.
  const [deleteOculpm, setDeleteOculpm] = useState(false);
  const [deleteAgentsMd, setDeleteAgentsMd] = useState(false);

  // Global overlays
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [greenfieldOpen, setGreenfieldOpen] = useState(false);
  // 대시보드 "복원" (감사 fix) — 저장된 초안을 마법사에 넘겨 이어서 시작.
  const [greenfieldResume, setGreenfieldResume] = useState<ProjectBlueprint | null>(null);

  // 시작 탭에는 마운트된 셸이 없다 — ⌘1~⌘0 · ⌘\ 는 갈 곳이 없으므로 삼키고
  // ⌘, 만 설정 오버레이로 잇는다 (⌘K 는 아래 onOpenPalette).
  useGlobalShortcuts({
    // 첫 실행 마법사가 떠 있는 동안은 ⌘K·⌘, 를 듣지 않는다 — 팔레트나 설정이
    // 마법사 **뒤에서** 열리면 (마법사가 최상층이다) 보이지 않는 창을 조작하게 된다.
    enabled: active && !welcomeOpen,
    onOpenPalette: () => setPaletteOpen(true),
    uiV2Nav: (v) => {
      if (v === "settings") setSettingsOpen(true);
    },
  });

  const refreshProjects = useCallback(async () => {
    setError(null);
    const res = await commands.listProjects();
    if (res.status === "ok") {
      setProjects(res.data);
      // 조회가 **성공했을 때만** 올린다 — 실패한 조회의 빈 목록을 "프로젝트
      // 0개" 로 읽으면 첫 실행 마법사가 엉뚱한 사람에게 뜬다.
      setProjectsLoaded(true);
    } else setError(res.error);
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  /**
   * 첫 실행 마법사를 **한 번만** 켠다.
   *
   * 조건 둘이 모두 참일 때만: 아직 한 번도 안 봤고(`onboarded=false`), 등록된
   * 프로젝트가 0개다. 두 번째 조건이 없으면 `onboarded` 키가 없던 기존 설치본
   * 전부가 업데이트 직후 안내를 다시 받는다.
   *
   * 켠 뒤에는 조건이 깨져도(마법사 안에서 프로젝트를 들여오면 목록이 1개가
   * 된다) 닫지 않는다 — 마무리 판을 보여 줘야 하므로 닫는 것은 마법사 몫이다.
   */
  useEffect(() => {
    const open = shouldOpenWelcome({
      active,
      settingsLoaded,
      projectsLoaded,
      onboarded: settings.onboarded,
      projectCount: projects.length,
    });
    if (!open) return;
    setWelcomeOpen(true);
    // 목록이 바뀌면 이 effect 는 다시 돌지만 하는 일은 없다 — 켜는 쪽으로만
    // 움직이고(멱등), 닫는 것은 마법사뿐이다.
  }, [active, settingsLoaded, projectsLoaded, settings.onboarded, projects.length]);

  const startIndex = useCallback(
    async (id: number, reset = false) => {
      setIndexingId(id);
      setError(null);

      if (reset) {
        const cleared = await commands.clearProjectIndex(id);
        if (cleared.status === "error") {
          setError(cleared.error);
          setIndexingId(null);
          return;
        }
      }

      const channel = new Channel<IndexProgress>();
      // 진행률 페이로드는 런처가 쓰지 않는다 — StartScreen 은 "이 프로젝트가
      // 색인 중"이라는 사실만 표시한다.
      channel.onmessage = () => {};

      const res = await commands.indexProject(id, channel);
      if (res.status === "error") setError(res.error);
      setIndexingId(null);

      await refreshProjects();
    },
    [refreshProjects],
  );

  // Chrome 의 새 탭에서 주소를 여는 것과 같다 — **이 탭이 그대로** 그 프로젝트가
  // 된다. 이미 다른 탭에 열려 있으면 백엔드가 그쪽을 활성화한다 (I1).
  const openProject = useCallback(
    (p: Project) => {
      void commands.setTabProject(tabId, p.id).then((res) => {
        if (res.status === "error")
          toast.destructive(t("project.openWindowFailed", { error: res.error }));
      });
    },
    [tabId, t],
  );

  /**
   * 폴더를 골라 프로젝트로 등록하고 **그 프로젝트를 돌려준다**.
   *
   * 첫 실행 마법사가 방금 들여온 프로젝트의 이름을 말하고 그걸 열어야 해서
   * 반환값이 필요하다 (예전에는 void 였다). `create_project` 는 id 만 주므로
   * 갱신된 목록에서 찾아 돌려준다.
   */
  const addProjectFromFolder = useCallback(async (): Promise<Project | null> => {
    setError(null);
    const folder = await commands.selectProjectFolder();
    if (folder.status !== "ok" || !folder.data) return null;
    const path = folder.data;
    const name = path.split("/").filter(Boolean).pop() ?? "project";
    const created = await commands.createProject(name, path);
    if (created.status !== "ok") {
      setError(created.error);
      return null;
    }
    const list = await commands.listProjects();
    if (list.status === "ok") {
      setProjects(list.data);
      setProjectsLoaded(true);
    }
    // Auto-chunk the freshly added project so 코드 검색 works without a manual
    // "재구축" step. Indexing is incremental (hash-gated), so later opens skip
    // unchanged files.
    void startIndex(created.data);
    return list.status === "ok"
      ? (list.data.find((p) => p.id === created.data) ?? null)
      : null;
  }, [startIndex]);

  function handleAddProject() {
    void addProjectFromFolder();
  }

  const startRenameProject = (p: Project) => {
    setRenamingProject(p);
    setNewName(p.name);
    setDraftTheme(p.theme_id ?? null);
    // 아직 고르지 않은 프로젝트는 이름에서 유도된 값을 초안으로 보여준다 —
    // 빈 상태에서 시작하면 "지금 무슨 색인지" 를 사용자가 알 수 없다.
    setDraftIcon(resolveProjectIcon(p.name, p.icon).id);
    setDraftColor(resolveProjectColor(p.name, p.color));
  };

  const handleSaveProject = async () => {
    if (!renamingProject || !newName.trim()) return;
    setError(null);
    const target = renamingProject;

    // 이름과 겉모습은 별도 커맨드다 — 이름은 다른 화면(프로젝트 관리)도 쓰는
    // 기존 계약이라 그대로 두고, 겉모습만 새 커맨드로 붙였다.
    if (newName.trim() !== target.name) {
      const res = await commands.renameProject(target.id, newName.trim());
      if (res.status === "error") {
        setError(res.error);
        return;
      }
    }
    const look = await commands.setProjectAppearance(target.id, draftIcon, draftColor);
    if (look.status === "error") {
      setError(look.error);
      return;
    }
    // 테마 바인딩은 세 번째 커맨드다 — 겉모습(아이콘·색)과 축이 다르고
    // (마크 vs 전체 표면), 바뀌면 창 전체가 다시 칠해져야 하므로 전용
    // 이벤트를 쏜다 (Osaurus 라운드 Phase 4).
    try {
      await themesApi.setProjectTheme(target.id, draftTheme);
    } catch (e) {
      setError(tError(toAppError(e)));
      return;
    }
    setRenamingProject(null);
    setNewName("");
    await refreshProjects();
  };

  const confirmDeleteProject = (p: Project) => {
    setDeleteOculpm(false);
    setDeleteAgentsMd(false);
    setDeletingProject(p);
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    setError(null);
    const res = await commands.deleteProject(deletingProject.id, deleteOculpm, deleteAgentsMd);
    if (res.status === "ok") {
      setDeletingProject(null);
      await refreshProjects();
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="h-full overflow-hidden">
      <StartScreen
        projects={projects}
        indexingId={indexingId}
        openWindows={openProjects}
        error={error}
        onSelectProject={openProject}
        onAddProject={handleAddProject}
        onRenameProject={startRenameProject}
        onDeleteProject={confirmDeleteProject}
        onOpenSettings={() => setSettingsOpen(true)}
        onStartGreenfield={() => {
          setGreenfieldResume(null);
          setGreenfieldOpen(true);
        }}
        onResumeBlueprint={(bp) => {
          setGreenfieldResume(bp);
          setGreenfieldOpen(true);
        }}
        onProjectsChanged={refreshProjects}
      />

      {welcomeOpen && (
        <Suspense fallback={null}>
          <WelcomeWizard
            onPickFolder={addProjectFromFolder}
            onStartGreenfield={() => {
              setGreenfieldResume(null);
              setGreenfieldOpen(true);
            }}
            onOpenProject={openProject}
            onClose={() => setWelcomeOpen(false)}
          />
        </Suspense>
      )}

      {/* 팔레트는 활성 탭에만 — 창에 하나만 존재해야 한다. */}
      {active && (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onOpenSettings={() => setSettingsOpen(true)}
          projects={projects}
          onSelectProject={openProject}
        />
      )}

      {active && settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}

      {greenfieldOpen && (
        <Suspense fallback={null}>
          <GreenfieldWizard
            resume={greenfieldResume}
            onClose={() => {
              setGreenfieldOpen(false);
              setGreenfieldResume(null);
            }}
            onComplete={async (projectId) => {
              setGreenfieldOpen(false);
              setGreenfieldResume(null);
              await refreshProjects();
              void commands.setTabProject(tabId, projectId);
            }}
          />
        </Suspense>
      )}

      {/* Rename / Delete dialogs */}
      {renamingProject && (
        <Dialog title={t("project.edit.title")} onClose={() => setRenamingProject(null)}>
          <p className="text-xs text-muted-foreground">{t("project.rename.hint")}</p>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-xl bg-background text-sm focus:outline-none focus:border-primary transition-colors text-foreground"
            placeholder={t("project.rename.placeholder")}
            aria-label={t("project.rename.placeholder")}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveProject();
              if (e.key === "Escape") setRenamingProject(null);
            }}
          />
          <AppearancePicker
            icon={draftIcon}
            color={draftColor}
            onIcon={setDraftIcon}
            onColor={setDraftColor}
          />
          <ProjectThemePicker value={draftTheme} onChange={setDraftTheme} />
          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={() => setRenamingProject(null)}
              className="px-4 py-2 border border-border hover:bg-accent rounded-xl text-xs font-semibold transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleSaveProject}
              disabled={!newName.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-xl text-xs font-semibold transition-colors"
            >
              {t("common.save")}
            </button>
          </div>
        </Dialog>
      )}

      {deletingProject && (
        <Dialog
          title={t("project.remove.title")}
          titleClass="text-destructive"
          onClose={() => setDeletingProject(null)}
        >
          {/* 대상 이름을 문장 안에 끼우지 않고 위에 단독으로 세운다 — 예전엔
              "{이름}을(를) … 제거하시겠습니까?" 처럼 굵은 이름이 문장 중간에
              박혀 있어 번역하려면 조사 자리에서 문자열을 쪼개야 했다. 파괴적
              확인 다이얼로그에서는 대상이 먼저 눈에 띄는 편이 낫기도 하다. */}
          <p className="font-bold text-foreground font-mono text-sm">{deletingProject.name}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("project.remove.confirm")}
            <br />
            <span className="text-destructive font-semibold">{t("project.remove.noteLabel")}</span>{" "}
            {t("project.remove.note")}
          </p>
          <div className="mt-1 space-y-1.5">
            <label className="flex items-start gap-2 p-2.5 rounded-xl border border-border bg-muted/40 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deleteOculpm}
                onChange={(e) => setDeleteOculpm(e.target.checked)}
                className="mt-0.5 accent-destructive"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">
                {t("project.remove.folderPrefix")}{" "}
                <code className="font-mono text-foreground">.oculpm</code>{" "}
                {t("project.remove.oculpmSuffix")}
              </span>
            </label>
            <label className="flex items-start gap-2 p-2.5 rounded-xl border border-border bg-muted/40 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deleteAgentsMd}
                onChange={(e) => setDeleteAgentsMd(e.target.checked)}
                className="mt-0.5 accent-destructive"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">
                {t("project.remove.folderPrefix")}{" "}
                <code className="font-mono text-foreground">AGENTS.md</code>{" "}
                {t("project.remove.agentsMdSuffix")}
              </span>
            </label>
            {(deleteOculpm || deleteAgentsMd) && (
              <p className="text-[11px] text-destructive px-1">
                {t("project.remove.irreversible")}
              </p>
            )}
          </div>
          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={() => setDeletingProject(null)}
              className="px-4 py-2 border border-border hover:bg-accent rounded-xl text-xs font-semibold transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleDeleteProject}
              className="px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl text-xs font-semibold transition-colors"
            >
              {t("project.remove.title")}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
