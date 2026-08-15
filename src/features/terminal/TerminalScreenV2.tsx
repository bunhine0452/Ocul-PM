import { useCallback, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import { PanelBottom } from "@/components/Icons";
import { useT } from "@/i18n";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { TerminalSurface } from "./TerminalSurface";

// 터미널 화면 (⌘10) — 툴바 + 터미널 본체.
//
// 2026-08-15: 본체는 `TerminalSurface` 로 나갔다. 같은 세션을 도크와 분리 창도
// 그리기 때문이다 (셋이 `terminalTabs` 를 공유). 예전에 툴바에 있던 검색·분할
// 버튼도 본체의 탭 줄로 옮겼다 — 도크에는 툴바가 없어서, 툴바에 두면 도크에서만
// 못 쓰는 조작이 생긴다.

interface TerminalScreenV2Props {
  projectRoot: string | null;
}

export function TerminalScreenV2({ projectRoot }: TerminalScreenV2Props) {
  const { t } = useT();
  const { setState } = useWorkspace();
  // 2026-07-16 정직성 수정: 예전 문구는 "에이전트 실행을 감지해 자동으로 일지를
  // 작성합니다" 였는데, PTY 쪽에 감지 코드가 한 줄도 없었다. 이제 셸 통합이
  // 실제로 켜져 있을 때만 그렇게 말한다.
  const [shellActive, setShellActive] = useState(false);
  const onShellActiveChange = useCallback((active: boolean) => setShellActive(active), []);

  /** 이 화면의 터미널을 그대로 도크로 내린다 — 세션은 같은 것이 이어진다. */
  const moveToDock = () =>
    setState((prev) => ({ ...prev, terminalDockOpen: true, uiV2View: "today" }));

  return (
    <>
      <Toolbar title={t("term.title")} sub={shellActive ? t("term.shellOn") : t("term.shellOff")}>
        <button className="btn" onClick={moveToDock} title={t("term.dock.moveHint")}>
          <PanelBottom size={15} /> {t("term.dock.move")}
        </button>
      </Toolbar>
      <TerminalSurface projectRoot={projectRoot} onShellActiveChange={onShellActiveChange} />
    </>
  );
}
