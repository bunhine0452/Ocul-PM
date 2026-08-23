/**
 * 탭 하나의 본문 — 프로젝트 하나의 전체 셸.
 *
 * 한 번이라도 연 탭은 **마운트된 채 유지**되고 비활성일 때만 숨는다 (Chrome
 * 처럼 백그라운드에서 watcher·PTY·AI 가 계속 돈다). 그래서 "창에 하나만 있어야
 * 하는 것"들은 `active` 로 게이트해야 한다 — 안 그러면 ⌘1 이 탭 수만큼
 * 발화하고, 창 전역 CustomEvent(`NAV_BUS`)에 모든 탭이 동시에 반응한다.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type Project, type IndexProgress } from "@/lib/bindings";

import { CommandPalette } from "@/components/CommandPalette";
import { SettingsOverlay } from "@/windows/SettingsOverlay";

import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useT } from "@/i18n";
import { oculpmLog } from "@/lib/oculpmLog";
import { toast } from "@/lib/toast";

const ShellV2 = lazy(() => import("@/features/shell/ShellV2"));

export interface ProjectTabProps {
  projectId: number;
  /** 이 창의 라벨 — 새 탭을 "이 창에" 붙이려면 필요하다. */
  windowLabel: string;
  active: boolean;
  /** 창의 프로젝트 목록 (팔레트·⌘P 공용) — 창이 한 번만 조회해 내려준다. */
  projects: Project[];
  /** 트레이 딥링크가 URL 로 실어 온 목적 화면 — 활성 탭에만 적용된다. */
  initialView?: string | null;
  initialEntryPath?: string | null;
  /** 딥링크를 소비했다고 창에 알린다 — 창은 한 번만 배달한다. */
  onDeepLinkConsumed?: () => void;
}

export default function ProjectTab({
  projectId,
  windowLabel,
  active,
  projects,
  initialView = null,
  initialEntryPath = null,
  onDeepLinkConsumed,
}: ProjectTabProps) {
  const { t } = useT();
  const { state, setState, setProjectMeta, setUiV2View, setIndexing, setOculpmStatus } =
    useWorkspace();
  const {
    currentProjectName: projectName,
    currentProjectRoot: projectRoot,
    indexingProjectId: indexingId,
  } = state;

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 단축키는 **활성 탭만** 듣는다 — 훅 안에서 조건부 return 을 하는 대신
  // enabled 로 넘겨 훅 호출 순서를 지킨다.
  useGlobalShortcuts({
    enabled: active,
    onOpenPalette: () => setPaletteOpen(true),
    // ⌘1~⌘0 + ⌘, drive the ui_v2 screens (01-ia-and-shell §3).
    uiV2Nav: (v: UiV2View) => {
      if (v === "settings") {
        setSettingsOpen(true);
        return;
      }
      setUiV2View(v);
    },
    // ⌘J — 어느 화면에서나 터미널 도크. 셸이 아니라 여기서 다는 이유는 이
    // 훅이 이미 "활성 탭만" 게이트를 들고 있어서다 (탭 수만큼 발화 방지).
    onToggleTerminalDock: () =>
      setState((prev) => ({ ...prev, terminalDockOpen: !prev.terminalDockOpen })),
  });

  // 딥링크는 활성 탭이 마운트되며 한 번 소비한다.
  useEffect(() => {
    if (active && (initialView || initialEntryPath)) onDeepLinkConsumed?.();
    // 마운트 시 1회 — 이후 탭을 오갈 때 다시 발화하면 안 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 셸이 쓸 이름·루트만 채운다 (id 는 탭이 정한 값 그대로 — I3).
  useEffect(() => {
    const me = projects.find((p) => p.id === projectId);
    if (me) setProjectMeta(me.name, me.root_path);
  }, [projects, projectId, setProjectMeta]);

  // .oculpm/ auto-init + watcher start (W1-PR7 + F-1 fix). Idempotent
  // server-side. Non-fatal: a project stays usable even if init fails.
  //
  // 탭이 사라질 때의 watcher 정리는 Rust 가 맡는다 (`release_project`) —
  // 프런트 언마운트는 창이 강제 종료되면 돌지 않는다.
  useEffect(() => {
    let cancelled = false;
    oculpmLog.flow("step 0 — project tab opened", { projectId });
    void (async () => {
      const initRes = await commands.oculpmInit(projectId);
      if (cancelled) return;
      if (initRes.status === "error") {
        oculpmLog.error("init", `oculpmInit failed: ${initRes.error}`, { projectId });
        setOculpmStatus(null);
        return;
      }
      oculpmLog.flow("step 1+2 OK — init + sync_agents returned to frontend", { projectId });
      const statusRes = await commands.oculpmGetStatus(projectId);
      if (cancelled) return;
      setOculpmStatus(statusRes.status === "ok" ? statusRes.data : null);

      const wsRes = await commands.oculpmWatcherStart(projectId);
      if (cancelled) return;
      if (wsRes.status === "error") {
        oculpmLog.error("watcher", `watcherStart failed: ${wsRes.error}`, { projectId });
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
                  else toast.destructive(t("watcher.takeOverFailed", { error: r.error }));
                })();
              },
            },
          ],
        });
      } else {
        oculpmLog.flow("step 3 OK — watcher running", { projectId });
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
                    toast.destructive(t("agents.upgrade.failed", { error: r.error }));
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
    // t 는 언어 전환마다 새 함수라 deps 에 넣으면 init 이 다시 돈다 — 탭 하나당
    // 1회만 도는 게 이 이펙트의 계약이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, setOculpmStatus]);

  // Auto-index on first open: if the opened project has no chunks yet, chunk it
  // in the background so 코드 검색 returns results instead of an empty list.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await commands.projectStats(projectId);
      if (cancelled || s.status !== "ok") return;
      if (s.data.chunks === 0) void startIndex();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function startIndex() {
    setIndexing(projectId, null);
    const channel = new Channel<IndexProgress>();
    channel.onmessage = (p) => setIndexing(projectId, p);
    const res = await commands.indexProject(projectId, channel);
    if (res.status === "error") {
      toast.destructive(t("settings.index.reindexFailed", { error: res.error }));
    }
    setIndexing(null);
  }

  return (
    <>
      <Suspense fallback={null}>
        <ShellV2
          active={active}
          projectName={projectName}
          projectRoot={projectRoot}
          initialView={active ? initialView : null}
          initialEntryPath={active ? initialEntryPath : null}
          onOpenProjectSwitcher={() => void commands.newStartTab(windowLabel)}
          onOpenProject={(id) => void commands.openProjectTab(id, windowLabel)}
        />
      </Suspense>

      {/* 팔레트·설정은 활성 탭의 워크스페이스 컨텍스트가 필요해서 탭 안에 산다.
          활성 탭에만 그려야 창에 하나만 존재한다. */}
      {active && (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onOpenSettings={() => setSettingsOpen(true)}
          onReindex={indexingId === null ? () => void startIndex() : undefined}
          projects={projects}
          // I1 — 팔레트의 "프로젝트 열기"는 이 창의 새 탭이거나, 이미 열려 있으면
          // 그 탭의 활성화다 (백엔드가 판단한다).
          onSelectProject={(p) => void commands.openProjectTab(p.id, windowLabel)}
        />
      )}
      {active && settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
