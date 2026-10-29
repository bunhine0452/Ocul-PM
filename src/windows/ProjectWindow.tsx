/**
 * 프로젝트 창의 본문 — 프로젝트 하나의 전체 셸 (창 하나 = 프로젝트 하나, 4.0).
 *
 * `.oculpm` 자동 초기화 + 워처 시작, ⌘K 팔레트, 딥링크 확인 시트를 배선하고 셸을
 * 지연 마운트한다. 3.x 의 탭 본문(`ProjectTab`)이었다 — 탭이 사라져 이 창에는
 * 늘 하나만 있으므로 `active` 게이트도 사라졌다.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { commands, type Project } from "@/lib/bindings";
import { oculpmApi } from "@/api/oculpm";
import { toAppError } from "@/api/invoke";

import { CommandPalette } from "@/components/CommandPalette";
import { onOpenPaletteRequest } from "@/lib/paletteNav";
import { windowApi } from "@/api/window";

import { useProjectRuntime, useUiPrefs } from "@/contexts/WorkspaceContext";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useNavHistory } from "@/hooks/useNavHistory";
import { useScreenCycle, useSwipeNav } from "@/hooks/useNavGestures";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { oculpmLog } from "@/lib/oculpmLog";
import { onOculpmActivateRequest } from "@/lib/projectActions";
import { toast } from "@/lib/toast";
import { DeepLinkSheet } from "@/features/deeplink/DeepLinkSheet";
import { openNavFor, resolveRegisteredProject } from "@/features/deeplink/deepLinkPlan";
import { UI_V2_VIEWS } from "@/contexts/uiV2View";
import { setAlertProjectName, useHookWaitingAlerts } from "@/features/terminal/attention";
import { SendToClaudeHost } from "@/features/terminal/SendToClaudeHost";
import { useTermCloseGuard } from "@/features/terminal/useTermCloseGuard";

const ShellV2 = lazy(() => import("@/features/shell/ShellV2"));

export interface ProjectWindowProps {
  projectId: number;
  /** 프로젝트 목록 (팔레트·⌘O 공용) — 창이 한 번만 조회해 내려준다. */
  projects: Project[];
  /** 목록을 다시 읽게 한다 — ⌘O 에서 폴더를 새로 들였을 때. */
  onProjectsChanged?: () => void;
  /** 트레이 딥링크가 URL 로 실어 온 목적 화면. */
  initialView?: string | null;
  initialEntryPath?: string | null;
  /** 딥링크를 소비했다고 창에 알린다 — 창은 한 번만 배달한다. */
  onDeepLinkConsumed?: () => void;
}

/** 다른 프로젝트는 다른 창이다 — 이미 열려 있으면 그 창이 앞으로 온다 (I1). */
function openProject(projectId: number, failed: (error: unknown) => void) {
  windowApi.openProjectWindow(projectId).catch(failed);
}

export default function ProjectWindow({
  projectId,
  projects,
  onProjectsChanged,
  initialView = null,
  initialEntryPath = null,
  onDeepLinkConsumed,
}: ProjectWindowProps) {
  const { t } = useT();
  // 조각만 구독한다 (v2.42.0 `{#workspace-full-consumers}`) — 합친 겉면을 쓰던
  // 때는 터미널 탭·검색어·도크 크기 같은 **이 컴포넌트가 읽지도 않는** 필드가
  // 바뀔 때마다 탭 본문(팔레트·딥링크 시트 포함)이 통째로 다시 그려졌다.
  const { currentProjectName: projectName, currentProjectRoot: projectRoot, setProjectMeta, setOculpmStatus } =
    useProjectRuntime();
  const { prefs, setPrefs, setUiV2View } = useUiPrefs();
  // ⌘[ / ⌘] — 화면 발자국 (E3). 관찰 기반이라 사이드바·팔레트 이동도 쌓인다.
  const navHistory = useNavHistory(prefs.uiV2View, setUiV2View);

  const [paletteOpen, setPaletteOpen] = useState(false);
  // 툴바 「찾기」 버튼 (`lib/paletteNav`) — ⌘K 와 같은 팔레트.
  useEffect(() => onOpenPaletteRequest(() => setPaletteOpen(true)), []);
  // Today 「지금 활성화」 — init 이펙트를 한 번 더 돌린다.
  const [initNonce, setInitNonce] = useState(0);
  useEffect(() => onOculpmActivateRequest(() => setInitNonce((n) => n + 1)), []);
  useGlobalShortcuts({
    onOpenPalette: () => setPaletteOpen(true),
    // ⌘1~⌘4 + ⌘, — 설정도 다른 화면과 똑같이 셸의 화면이다.
    uiV2Nav: setUiV2View,
    onNavBack: navHistory.goBack,
    onNavForward: navHistory.goForward,
  });
  // ⌃Tab 화면 순환 · 트랙패드 두 손가락 쓸기 — 윗줄까지 가지 않고 (ocul-next #nav-cycle).
  useScreenCycle(prefs.uiV2View, setUiV2View);
  useSwipeNav(navHistory.goBack, navHistory.goForward);

  // 딥링크는 창이 마운트되며 한 번 소비한다.
  useEffect(() => {
    if (initialView || initialEntryPath) onDeepLinkConsumed?.();
    // 마운트 시 1회.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFailed = (e: unknown) => toast.destructive(t("project.openWindowFailed", { error: tError(toAppError(e)) }));

  // 셸이 쓸 이름·루트만 채운다 (id 는 창이 정한 값 그대로 — I3).
  useEffect(() => {
    const me = projects.find((p) => p.id === projectId);
    if (me) setProjectMeta(me.name, me.root_path);
  }, [projects, projectId, setProjectMeta]);

  // .oculpm/ auto-init + watcher start (W1-PR7 + F-1 fix). Idempotent
  // server-side. Non-fatal: a project stays usable even if init fails.
  //
  // 워처는 앱 시작 때 추적 중인 모든 프로젝트에 대해 이미 돈다(`start_background_
  // watchers`) — 여기의 시작은 그 사이 새로 들인 프로젝트를 위한 것이고 멱등이다.
  useEffect(() => {
    let cancelled = false;
    oculpmLog.flow("step 0 — project window opened", { projectId });
    void (async () => {
      const initRes = await commands.oculpmInit(projectId);
      if (cancelled) return;
      if (initRes.status === "error") {
        // 봉투의 error 는 `AppError` 객체다 — 템플릿에 그대로 넣으면 로그에
        // `[object Object]` 만 남는다 (2026-09-18 oculpm.log 에서 발견).
        const initErr = toAppError(initRes.error);
        oculpmLog.error("init", `oculpmInit failed: ${initErr.detail ?? initErr.code}`, { projectId });
        setOculpmStatus(null);
        // 예전엔 로그 한 줄뿐이라 Today 의 "아직 활성화되지 않았어요" 가 이유도
        // 재시도도 없이 그대로였다 (완성도 감사 2026-08-30).
        toast.destructive(t("today.activateFailed", { error: tError(initRes.error) }), {
          dedupKey: `oculpm-init-failed-${projectId}`,
          actions: [{ label: t("common.retry"), onClick: () => setInitNonce((n) => n + 1) }],
        });
        return;
      }
      oculpmLog.flow("step 1+2 OK — init + sync_agents returned to frontend", { projectId });
      // config.toml 을 새로 썼다 = 이 저장소에 ocul-pm 이 처음 들어왔다. 무엇을
      // 썼는지 Today 첫 활성화 카드가 그대로 보여 준다 (재오픈의 빈 보고는 무시).
      const rep = initRes.data;
      if (rep.wrote_config) {
        setPrefs(() => ({
          oculpmInitCard: {
            createdDirs: rep.created_dirs,
            wroteConfig: rep.wrote_config,
            wroteGitignore: rep.wrote_gitignore,
            agentFiles: rep.agent_files,
            at: Date.now(),
          },
        }));
      }
      if (initNonce > 0) toast.info(t("today.activated"));
      const statusRes = await commands.oculpmGetStatus(projectId);
      if (cancelled) return;
      setOculpmStatus(statusRes.status === "ok" ? statusRes.data : null);

      // `.oculpm` 커맨드는 `oculpmApi` 를 지난다 (CLAUDE.md) — 봉투 대신 던지므로
      // 실패 경로는 catch 로 옮겼고, 문구·감독관 안내는 그대로다.
      let watcherFailed: unknown = null;
      try {
        await oculpmApi.watcherStart(projectId);
      } catch (e) {
        watcherFailed = e;
      }
      if (cancelled) return;
      if (watcherFailed !== null) {
        const err = toAppError(watcherFailed);
        oculpmLog.error("watcher", `watcherStart failed: ${err.detail ?? err.code}`, { projectId });
        // 예전엔 로그 한 줄이 전부였다 — 그래서 "AI 가 일지를 써도 화면이 안
        // 바뀐다" 를 겪은 사람에게 원인을 알려 줄 방법이 없었고, 웹뷰를 직접
        // 새로고침하는 것만이 유일한 대처가 됐다 (도그푸딩 2026-08-23).
        // 감독관이 1분마다 되살리므로 문구는 "복구 중" 이지 "실패" 가 아니다.
        toast.warning(t("watcher.offline"), {
          title: t("watcher.offlineTitle"),
          dedupKey: `watcher-offline-${projectId}`,
          durationMs: 0, // 사용자가 판단해 누를 버튼이 달려 있다
          actions: [
            {
              label: t("watcher.takeOver"),
              onClick: () => {
                void (async () => {
                  const r = await commands.oculpmWatcherTakeOver(projectId);
                  if (r.status === "ok") toast.info(t("watcher.tookOver"));
                  else toast.destructive(t("watcher.takeOverFailed", { error: tError(r.error) }));
                })();
              },
            },
          ],
        });
      } else {
        oculpmLog.flow("step 3 OK — watcher running", { projectId });
      }

      // 반대 방향 — 디스크의 템플릿이 이 앱보다 **새롭다**. 고칠 길은 앱
      // 업데이트뿐이라 여태 조용히 지나갔다. 이제는 말한다
      // (Phase 6 #not-honored-notice). 업그레이드 제안과 배타적이다.
      const aheadRes = await commands.oculpmAgentsCheckMasterAhead(projectId);
      if (cancelled) return;
      if (aheadRes.status === "ok" && aheadRes.data) {
        toast.warning(t("agents.ahead.title"), {
          title: t("agents.ahead.version", {
            disk: aheadRes.data.from_version,
            app: aheadRes.data.to_version,
          }),
          dedupKey: `master-ahead-${projectId}`,
          durationMs: 20000,
        });
      }

      // Offer a master-template upgrade for projects initialized before a
      // template bump (their on-disk AGENTS.md is stale vs the shipped rules).
      const upRes = await commands.oculpmAgentsCheckMasterUpgrade(projectId);
      if (cancelled) return;
      if (upRes.status === "ok" && upRes.data) {
        const { from_version, to_version } = upRes.data;
        toast.warning(t("agents.upgrade.title"), {
          title: t("agents.upgrade.version", { from: from_version, to: to_version }),
          dedupKey: `master-upgrade-${projectId}`,
          durationMs: 20000,
          actions: [
            {
              label: t("agents.upgrade.action"),
              onClick: () => {
                void (async () => {
                  const r = await commands.oculpmAgentsApplyMasterUpgrade(projectId);
                  if (r.status === "ok") {
                    toast.info(t("agents.upgrade.done"));
                  } else {
                    toast.destructive(t("agents.upgrade.failed", { error: tError(r.error) }));
                  }
                })();
              },
            },
          ],
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // t 는 언어 전환마다 새 함수라 deps 에 넣으면 init 이 다시 돈다 — 창 하나당
    // 1회만 도는 게 이 이펙트의 계약이다 (+ 사용자가 「지금 활성화」 를 누른 만큼).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, setOculpmStatus, initNonce]);

  const closeGuard = useTermCloseGuard(projects);
  useEffect(() => setAlertProjectName(projectName), [projectName]);
  useHookWaitingAlerts(projectId);

  return (
    <>
      {closeGuard}
      <SendToClaudeHost projectId={projectId} />
      <Suspense fallback={null}>
        <ShellV2
          projectName={projectName}
          projectRoot={projectRoot}
          projects={projects}
          onProjectsChanged={onProjectsChanged}
          initialView={initialView}
          initialEntryPath={initialEntryPath}
          onOpenProject={(id) => openProject(id, openFailed)}
        />
      </Suspense>

      {/* 딥링크 확인 시트 (Phase 6 #deep-link). 승인 전에는 아무 일도 일어나지
          않는다: 백엔드는 URL 을 파싱해 이벤트로 넘기기만 했다. */}
      <DeepLinkSheet
        onAccept={(link) => {
          // 4.0 의 딥링크는 `open` 하나다 — 설치 링크(skill/plugin install)는 백엔드가 거절한다.
          const id = resolveRegisteredProject(projects, link.project);
          if (id === null) {
            toast.warning(t("deeplink.open.notRegistered"));
            return;
          }
          // view 까지 싣는다 — 창을 열거나 앞으로 가져온 뒤 그 창에만
          // WindowNavigate 를 쏘는 경로(open_project_nav)를 탄다.
          void commands.openProjectNav(openNavFor(link, id, UI_V2_VIEWS));
        }}
      />

      {/* 팔레트는 이 창의 워크스페이스 컨텍스트가 필요해서 여기 산다. */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenSettings={() => setUiV2View("settings")}
        projects={projects}
        onSelectProject={(p) => openProject(p.id, openFailed)}
      />
    </>
  );
}
