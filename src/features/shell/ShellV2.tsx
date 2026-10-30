import { Suspense, useEffect, useState } from "react";
import { safeUnlistenPromise } from "@/lib/unlisten";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToolbarSlotContext } from "@/components/toolbarSlot";
import { TopBar } from "./TopBar";
import { useProjectRuntime, useUiPrefs, type UiV2View } from "@/contexts/WorkspaceContext";
import { NAV_BUS } from "@/lib/navRegistry";
import { resumeAfterUpdate } from "@/features/terminal/resumeAfterUpdate";
import { useT } from "@/i18n";
import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { JournalScreenV2 } from "@/features/oculpm/JournalScreenV2";
import { DiffScreenV2 } from "@/features/diff/DiffScreenV2";
import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
// 설정은 지연 청크다 — 목록과 그 이유는 `./screens` 가 소유한다.
import { SettingsPage, TerminalScreen } from "./screens";
import { KNOWN_VIEWS, useShellNav } from "./useShellNav";
import { useNavBadges } from "./useNavBadges";
import { useTodayExceptions } from "@/features/today/useTodayExceptions";
import { SkeletonList } from "@/components/ui/Skeleton";
import { events, type JournalEntrySummary, type Project } from "@/lib/bindings";
import { isMac as isMacPlatform } from "@/lib/platform";

// The 5 token/layer stylesheets. This static import is the token-isolation
// mechanism (PR-UI 0 §0.6): App lazy-loads ShellV2 via React.lazy, so Vite
// emits this CSS as a SEPARATE chunk that the browser fetches only when the
// ui_v2 shell first mounts. flag-off never loads the ShellV2 chunk → the new
// --accent (green) never reaches the legacy cream UI. (Verified in PR-UI 1:
// the build emits a distinct ShellV2 CSS chunk; the main bundle keeps only the
// legacy tokens.)
import "@/styles/index.css";

// 4.0 셸 — 윗줄 하나(프로젝트 · 탭 넷 · 화면 동작 · 찾기 · 설정) + 다섯 화면 라우터.
// 사이드바는 걷었다 — 그 옆에 일지·계획·파일 목록 칸이 또 서면 왼쪽이 두 겹이었다.
// 각 화면은 자기 <Toolbar> 를 그리고, 그 동작은 윗줄의 자리로 포털된다(`ToolbarSlotContext`).
// 셸은 윗줄과 라우터만 소유한다. 화면 목록의 정본은 `lib/navRegistry.ts` 다.
//
// 셸이 소유하지 **않는** 두 결은 옆 파일에 있다: 지연 청크 목록은 `./screens`, 화면
// 밖에서 온 이동 요청과 한 번짜리 핸드오프는 `./useShellNav`.

interface ShellV2Props {
  projectName: string | null;
  projectRoot: string | null;
  /** 프로젝트 목록 (⌘O 목록) — 창이 한 번만 조회해 내려준다. */
  projects: Project[];
  onProjectsChanged?: () => void;
  /** 다른 프로젝트의 창을 연다 (이미 열려 있으면 그 창이 앞으로 — I1). */
  onOpenProject: (projectId: number) => void;
  /** 트레이 딥링크가 URL 로 실어 온 목적 화면 — mount 시 1회 적용. */
  initialView?: string | null;
  /** 트레이 딥링크가 URL 로 실어 온 `.oculpm` 상대 일지 경로. */
  initialEntryPath?: string | null;
}

export default function ShellV2({
  projectName,
  projectRoot,
  projects,
  onProjectsChanged,
  onOpenProject,
  initialView = null,
  initialEntryPath = null,
}: ShellV2Props) {
  const { lang } = useT();
  // 조각만 구독한다 (v2.42.0 `{#workspace-full-consumers}`).
  const { prefs, setPrefs, setUiV2View } = useUiPrefs();
  const runtime = useProjectRuntime();
  const view = prefs.uiV2View;
  const projectId = runtime.currentProjectId;
  const workday = runtime.workdayKey ?? runtime.oculpmStatus?.current_workday ?? null;
  const oculpmReady = runtime.oculpmStatus?.initialized === true;
  // 「오늘」 배지 = 오늘 화면의 확인할 것 수 — 같은 규칙(`todayModel.buildExceptions`)으로 센다.
  const todayCheck = useTodayExceptions(projectId ?? 0, workday, oculpmReady && projectId != null);
  const badges = useNavBadges(projectId, workday, oculpmReady, todayCheck.count);

  // 트레이 딥링크·팔레트 점프·「수동 일지」 처럼 **다른 화면이 쏜 이동 요청**과
  // 그 한 번짜리 핸드오프는 조각 훅이 소유한다 (`./useShellNav`).
  const {
    journalFocus,
    setJournalFocus,
    journalOpenEntry,
    setJournalOpenEntry,
    clearJournalOpenEntry,
    journalReturnView,
    setJournalReturnView,
    jumpNonce,
  } = useShellNav({
    view,
    projectId,
    setUiV2View,
    setPrefs,
    initialView,
    initialEntryPath,
  });

  // 화면 전환 요청 (`NAV_BUS.setView`) — 프로바이더를 모르는 자리가 쏜다.
  useEffect(() => {
    const onSet = (e: Event) => {
      const next = (e as CustomEvent<UiV2View>).detail;
      if (next) setUiV2View(next);
    };
    window.addEventListener(NAV_BUS.setView, onSet);
    return () => window.removeEventListener(NAV_BUS.setView, onSet);
  }, [setUiV2View]);

  // 업데이트 재시작 뒤 — 이 창에서 돌던 claude 대화를 잇는다(평소엔 빈 목록 하나를 묻고 끝).
  useEffect(() => {
    if (projectId == null) return;
    void resumeAfterUpdate(projectId).catch(() => {});
  }, [projectId]);

  const isMac = isMacPlatform();
  // 화면 동작이 포털될 윗줄의 자리 — 붙은 뒤에야 화면이 그 안으로 그린다.
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);

  // 딥링크 이동 — 확인 시트가 open_project_nav 로 쏜 WindowNavigate 를 받아
  // 화면·일지로 이동한다.
  useEffect(() => {
    const un = events.windowNavigate.listen(({ payload }) => {
      // 백엔드가 대상 창을 지정해 쏘지만(T5), 라벨이 어긋난 페이로드가 남의
      // 일지로 창을 끌고 가지 못하도록 여기서도 한 번 더 확인한다.
      if (payload.project_id != null && payload.project_id !== projectId) return;
      if (payload.entry_path) {
        setJournalReturnView(null);
        setJournalOpenEntry(payload.entry_path);
        setUiV2View("journal");
        return;
      }
      setUiV2View(KNOWN_VIEWS.includes(payload.view) ? (payload.view as UiV2View) : "today");
    });
    return () => {
      safeUnlistenPromise(un);
    };
  }, [projectId, setUiV2View, setJournalOpenEntry, setJournalReturnView]);

  // 툴바 날짜는 UI 언어를 따른다 — `"ko-KR"` 이 박혀 있어 영어 모드에서도
  // 「2026년 9월 11일 금」이었다 (2026-09-11 영문 스크린샷 촬영에서 잡음).
  const dateLabel = new Date().toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  // 경로만 읽는다 — Today 첫 기록 카드는 요약 없이 경로만 들고 온다.
  const openEntryInJournal = (entry: Pick<JournalEntrySummary, "relative_path">) => {
    setJournalFocus(entry.relative_path);
    setUiV2View("journal");
  };

  // A journal card → 변경 diff 화면. Park the path on WorkspaceContext.
  // diffActivePath so PR-UI 4's DiffScreen can pre-select it.
  const openDiffForEntry = (entry: JournalEntrySummary) => {
    setPrefs(() => ({ diffActivePath: entry.relative_path }));
    setUiV2View("diff");
  };

  return (
    <div className={"app" + (isMac ? " is-mac" : "")}>
      <TopBar
        view={view}
        onNavigate={setUiV2View}
        projectName={projectName}
        currentProjectId={projectId}
        projects={projects}
        onOpenProject={onOpenProject}
        onProjectsChanged={onProjectsChanged}
        badges={badges}
        slotRef={setActionSlot}
      />
      <ToolbarSlotContext.Provider value={actionSlot}>
      <main className="content">
        <div className="content-main">
        {/* v2 U6 — lazy 화면 공용 fallback: 콘텐츠 스켈레톤.
            스피너 대신 콘텐츠 형태를 유지해 화면 전환 점프를 줄인다. */}
        <Suspense
          fallback={
            <div className="scroll">
              <div className="page">
                <SkeletonList rows={4} height={76} />
              </div>
            </div>
          }
        >
        {/* 화면 단위 렌더 경계 (2026-09-04). 화면 하나가 렌더 중 throw 해도
            윗줄은 살아 있고 다른 화면으로 걸어 나갈 수 있다 — 경계가 창 층에만
            있으면 윗줄·탈출로까지 함께 대체 UI 로 바뀐다.

            `key={view}` — 경계는 화면을 바꿔도 스스로 리셋되지 않는다. 키가
            없으면 한 번 깨진 뒤 다른 화면에 갔다 돌아와도 계속 깨진 채로
            보인다 (모든 갈래가 서로 다른 컴포넌트 타입이라 어차피 재마운트가
            일어나므로, 키를 붙여도 새로 잃는 상태는 없다). */}
        <ErrorBoundary key={view} label={`screen:${view}`}>
        {view === "settings" ? (
          <SettingsPage />
        ) : projectId == null ? null : view === "journal" ? (
          <JournalScreenV2
            active
            projectId={projectId}
            todayKey={workday}
            oculpmReady={oculpmReady}
            onOpenDiff={openDiffForEntry}
            focusPath={journalFocus}
            onFocusConsumed={() => setJournalFocus(null)}
            openEntryPath={journalOpenEntry}
            onOpenEntryConsumed={clearJournalOpenEntry}
            onReturnToOrigin={
              journalReturnView
                ? () => {
                    const target = journalReturnView;
                    setJournalReturnView(null);
                    setUiV2View(target);
                  }
                : undefined
            }
          />
        ) : view === "diff" ? (
          <DiffScreenV2
            projectId={projectId}
            projectRoot={projectRoot}
            branch={null}
            onOpenEntry={(path) => {
              setJournalFocus(path);
              setUiV2View("journal");
            }}
          />
        ) : view === "terminal" ? (
          <TerminalScreen projectId={projectId} workday={workday} />
        ) : view === "planner" ? (
          <PlannerScreenV2
            key={`planner-${jumpNonce}`}
            projectId={projectId}
            onNavigate={setUiV2View}
            onOpenJournal={(path) => {
              setJournalReturnView("planner");
              setJournalOpenEntry(path);
              setUiV2View("journal");
            }}
          />
        ) : (
          // 사슬의 **마지막 갈래가 Today** 다 (2026-09-06). 예전엔 `null` 이라,
          // `view` 가 어떤 갈래에도 안 맞으면 툴바도 콘텐츠도 없는 빈 본문이
          // 남았다 — 화면 id 를 하나 없애는 순간 그 화면에 머물던 사용자가
          // 곧장 그 상태였다. `migrateUiV2View` 가 영속값을 이미 거르지만
          // 런타임 `setUiV2View` 는 그 문을 지나지 않으므로 여기도 막는다.
          // (Today 갈래를 위로 다시 올리지 말 것 — 폴백과 한 몸이다.)
          <TodayScreenV2
            projectId={projectId}
            projectRoot={projectRoot}
            workday={workday}
            oculpmReady={oculpmReady}
            onNavigate={setUiV2View}
            onOpenEntry={openEntryInJournal}
            dateLabel={dateLabel}
            tz={Intl.DateTimeFormat().resolvedOptions().timeZone}
          />
        )}
        </ErrorBoundary>

        </Suspense>
        </div>
      </main>
      </ToolbarSlotContext.Provider>
    </div>
  );
}
