import { PanelBottom } from "@/components/Icons";
import { useT } from "@/i18n";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { TerminalSurface } from "./TerminalSurface";

// 터미널 화면 (⌘10) — 터미널 본체에 화면 제목과 「도크로」만 얹는다.
//
// 2026-08-15: 본체는 `TerminalSurface` 로 나갔다. 같은 세션을 도크와 분리 창도
// 그리기 때문이다 (셋이 `terminalTabs` 를 공유).
//
// 2026-10-25 시안 A: 화면 툴바를 따로 그리지 않는다. 본체의 머리줄이 `screenTitle`
// 을 받아 화면 툴바(`Toolbar`)로 그려지고, 레일 토글·세션 이름·검색·분할·보기 메뉴가
// 그 한 줄에 모인다. 셸 통합 부제는 상태바의 점으로 갔다 — 세 갈래 판정
// (`deriveIntegrationStatus`)과 설치 여부 조회(`useShellInstalled`)도 함께 갔다.

interface TerminalScreenV2Props {
  projectRoot: string | null;
}

export function TerminalScreenV2({ projectRoot }: TerminalScreenV2Props) {
  const { t } = useT();
  const { setState } = useWorkspace();

  /** 이 화면의 터미널을 그대로 도크로 내린다 — 세션은 같은 것이 이어진다. */
  const moveToDock = () =>
    setState((prev) => ({ ...prev, terminalDockOpen: true, uiV2View: "today" }));

  return (
    <TerminalSurface
      projectRoot={projectRoot}
      screenTitle={t("term.title")}
      headerActions={
        <button className="btn" onClick={moveToDock} title={t("term.dock.moveHint")}>
          <PanelBottom size={15} /> {t("term.dock.move")}
        </button>
      }
    />
  );
}
