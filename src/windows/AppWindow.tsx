/**
 * 앱 창 — **창 하나 = 프로젝트 하나** (4.0).
 *
 * 창은 시작 창(프로젝트 없음) 아니면 프로젝트 하나의 셸이다. 어느 쪽인지의 SSOT 는
 * 백엔드 레지스트리다(프로젝트당 창 하나라는 전역 유일성을 창을 가로질러 심판해야
 * 하므로) — 이 창은 마운트 때 한 번 묻고, 이후는 `WindowProjectChanged` 를 따라
 * 그린다. 시작 창에서 프로젝트를 고르면 같은 창이 그 프로젝트가 되고, 그 프로젝트를
 * 지우면 같은 창이 시작 창으로 돌아온다.
 *
 * 3.x 의 크롬식 탭(탭 줄·떼어내기·창 사이 끌기)은 걷었다 — 다른 프로젝트는 다른
 * 창이고, 창 사이는 OS 의 창 전환이 오간다.
 */
import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/lib/bindings";

import { BootSplash } from "@/components/BootSplash";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UpdateBanner } from "@/components/UpdateBanner";
import { EmbeddingModelBanner } from "@/components/EmbeddingModelBanner";
import { ShortcutCheatsheet } from "@/components/ShortcutCheatsheet";
import { StartWindow } from "@/features/start/StartWindow";
import ProjectWindow from "@/windows/ProjectWindow";

import { projectsApi } from "@/api/projects";
import { windowApi } from "@/api/window";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { pruneWorkspaceRecords } from "@/contexts/workspacePrune";
import { useSeededEvent } from "@/hooks/useSeededEvent";
import { useWindowKeys } from "@/hooks/useWindowKeys";
import { installConsoleBridge, oculpmLog } from "@/lib/oculpmLog";

import "@/App.css";
// 창 셸 CSS — 시작 창에도 필요하므로 ShellV2 의 lazy 청크가 아니라 여기서 가져온다.
import "./window.css";

export interface AppWindowProps {
  windowLabel: string;
  initialView?: string | null;
  initialEntryPath?: string | null;
}

/** 이 창의 프로젝트 — `undefined` 는 아직 백엔드에 묻는 중(첫 프레임). */
type WindowProject = number | null | undefined;

export default function AppWindow({
  windowLabel,
  initialView = null,
  initialEntryPath = null,
}: AppWindowProps) {
  const [projectId, setProjectId] = useState<WindowProject>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  /**
   * 트레이 딥링크는 **창에 한 번** 배달된다. URL 은 창 수명 내내 그대로라, 지운
   * 프로젝트의 창이 시작 창으로 돌아갔다가 다른 프로젝트가 되면 같은 목적지로 다시
   * 점프해 버린다.
   */
  const [deepLink, setDeepLink] = useState<{ view: string | null; entry: string | null } | null>(
    initialView || initialEntryPath ? { view: initialView, entry: initialEntryPath } : null,
  );

  useEffect(() => {
    installConsoleBridge();
    oculpmLog.flow("App window mounted", { windowLabel });
  }, [windowLabel]);

  // 구독 먼저, 물음은 그다음 — 먼저 물으면 그 사이 도착한 변경(업데이트 복원이 첫
  // 창에 프로젝트를 싣는 순간)을 늦게 온 답이 덮는다. 웹뷰 밖(브라우저 미리보기)
  // 에서는 물음이 실패한다 — 시작 창으로 선다.
  useSeededEvent<number | null>(
    {
      seed: () => windowApi.projectOf(windowLabel).catch(() => null),
      subscribe: (touch) => [
        windowApi.onProjectChanged((payload) => {
          if (payload.window !== windowLabel) return;
          touch();
          setProjectId(payload.project_id);
        }),
      ],
      onSeed: (pid, touched) => {
        if (!touched()) setProjectId(pid);
      },
    },
    [windowLabel],
  );

  const refreshProjects = useCallback(() => {
    void projectsApi
      .list()
      .then((list) => {
        setProjects(list);
        // 지워진 프로젝트의 워크스페이스 레코드 정리 (D3) — 목록이 진실이다.
        pruneWorkspaceRecords(list.map((p) => p.id));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (projectId != null) refreshProjects();
  }, [projectId, refreshProjects]);

  // 창 제목 = 프로젝트 이름 (macOS 창 전환기·Mission Control 구분용).
  const project = projectId == null ? null : (projects.find((p) => p.id === projectId) ?? null);
  useEffect(() => {
    document.title = project?.name || "Ocul-PM";
  }, [project?.name]);

  // ⌘W(창 닫기) · ⇧⌘N(새 창)의 Windows·Linux 판. macOS 는 앱 메뉴가 받는다.
  useWindowKeys();

  return (
    <div className="winroot">
      {/* 부트 스플래시 — 창당 1회, 첫 페인트를 브랜드 모션으로 덮는다. */}
      <BootSplash />
      {projectId === undefined ? null : (
        // 창 하나의 예외가 창 전체를 하얗게 지우지 못하게 막는 바깥 경계. 키를
        // 프로젝트로 두면 시작 창 → 프로젝트 창 전환이 깨진 경계를 끌고 가지 않는다.
        <ErrorBoundary key={projectId ?? "start"} label={projectId == null ? "start-window" : "project-window"}>
          {projectId == null ? (
            <StartWindow />
          ) : (
            <WorkspaceProvider projectId={projectId}>
              <ProjectWindow
                projectId={projectId}
                projects={projects}
                onProjectsChanged={refreshProjects}
                initialView={deepLink?.view ?? null}
                initialEntryPath={deepLink?.entry ?? null}
                onDeepLinkConsumed={() => setDeepLink(null)}
              />
            </WorkspaceProvider>
          )}
        </ErrorBoundary>
      )}

      {/* 창당 하나면 되는 것들. */}
      <UpdateBanner />
      <EmbeddingModelBanner />
      <ShortcutCheatsheet />
    </div>
  );
}
