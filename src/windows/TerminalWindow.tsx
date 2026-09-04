/**
 * 분리 터미널 창 (2026-08-15) — 도크의 ⇱ 로 떼어낸 셸의 집.
 *
 * 탭을 물지 않는 경량 창이다: 사이드바도 탭 스트립도 없이 터미널 본체만
 * 그린다. 세션은 앱 안에서 쓰던 **그대로**다 — PTY 는 Rust 에 살아 있고
 * sid 가 프로젝트 기준(`p<projectId>-`)이라, 여기서 같은 sid 로 attach 하면
 * 스크롤백까지 이어 붙는다. 탭 목록은 프로젝트별 영속 레코드에서 읽으므로
 * (WorkspaceProvider) 창을 넘어와도 같은 탭이 그대로 있다.
 *
 * 창이 닫히면 Rust 가 판단한다: 프로젝트 탭이 아직 열려 있으면 셸을 살려 두고
 * (앱 안 도크로 되돌아간다), 아무도 없으면 그때 정리한다.
 */
import { useEffect, useState } from "react";
import { commands, events } from "@/lib/bindings";
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import { TerminalSurface } from "@/features/terminal/TerminalSurface";
import { setThemeOverride } from "@/features/theme/store";
import { installConsoleBridge } from "@/lib/oculpmLog";
import { runNewTabIntent } from "@/lib/newTabIntent";
import { createUnlistenBag } from "@/lib/unlisten";
import { terminalWindowLabel } from "@/lib/windowRoute";
import { useT } from "@/i18n";

import "@/App.css";
// 셸 CSS 는 ShellV2 의 lazy 청크에 실려 있다 — 그 셸을 마운트하지 않는 이 창은
// 직접 가져와야 터미널 토큰(--term-*)과 크롬이 산다.
import "@/styles/index.css";

export interface TerminalWindowProps {
  projectId: number;
}

export default function TerminalWindow({ projectId }: TerminalWindowProps) {
  useEffect(() => {
    installConsoleBridge();
  }, []);
  return (
    // 이 창은 영속 레코드에서 **터미널 세션만** 소유한다 — 화면·필터 같은
    // 나머지는 앱 창이 계속 바꾸고 있어서, 우리가 마운트할 때 읽은 스냅샷으로
    // 되돌리면 사용자가 저쪽에서 한 일이 지워진다.
    <WorkspaceProvider projectId={projectId} persistScope="terminal">
      <TerminalWindowBody projectId={projectId} />
    </WorkspaceProvider>
  );
}

function TerminalWindowBody({ projectId }: TerminalWindowProps) {
  const { t } = useT();
  const { setProjectMeta } = useWorkspace();
  const [root, setRoot] = useState<string | null>(null);
  // 루트를 모르는 채 셸을 띄우면 홈 디렉터리에서 뜬다 — 프로젝트에서 일하려고
  // 떼어낸 창이므로 경로가 올 때까지 기다린다 (한 번의 조회, 대개 즉시).
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void commands.listProjects().then((res) => {
      if (!alive) return;
      if (res.status === "ok") {
        const me = res.data.find((p) => p.id === projectId);
        if (me) {
          setRoot(me.root_path);
          setProjectMeta(me.name, me.root_path);
          // 이 창은 프로젝트 하나만 보여 준다 — 바인딩된 테마가 있으면 그대로
          // 이 창의 색이다 (Osaurus 라운드 Phase 4, 창 단위 적용).
          setThemeOverride(me.theme_id ?? null);
          document.title = t("term.window.title", { project: me.name });
        }
      }
      setReady(true);
    });
    return () => {
      alive = false;
    };
    // t 는 언어 전환마다 새 함수라 deps 에 넣으면 조회가 다시 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, setProjectMeta]);

  // ⌘T — 이 창에는 프로젝트 탭이 없다. 메뉴가 쏘는 의도를 받아 **터미널 탭**을
  // 연다 (아래 `ownsNewTab`). 받지 않으면 Rust 는 아무 것도 하지 않으므로
  // 분리 창에서 ⌘T 가 통째로 씹힌다.
  useEffect(() => {
    const label = terminalWindowLabel(projectId);
    const bag = createUnlistenBag();
    bag.add(
      events.newTabIntent.listen(({ payload }) => {
        if (payload.window !== label) return;
        runNewTabIntent();
      }),
    );
    return () => bag.dispose();
  }, [projectId]);

  // macOS 는 titleBarStyle "Overlay" 라 신호등이 왼쪽 위에 떠 있다. 이 창엔
  // 탭 스트립이 없어 그 자리를 대신 져 줄 것이 없으므로 탭 줄이 직접 비운다.
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  return (
    <div className={"term-window" + (isMac ? " is-mac" : "")}>
      {ready ? <TerminalSurface projectRoot={root} dragRegion ownsNewTab /> : null}
    </div>
  );
}
