import { SquareTerminal } from "@/components/Icons";
import { commands } from "@/lib/bindings";
import { useT } from "@/i18n";

// 터미널이 분리 창에 나가 있을 때 앱 안에 남는 자리표시자 (2026-08-15).
//
// 세션은 하나뿐이고 그 주인은 지금 분리 창이다 — 여기서 같은 PTY 에 xterm 을
// 하나 더 붙이면 두 뷰의 fit() 이 서로를 되돌려 양쪽 화면이 떨린다. 그래서
// 비워 두되, **어디로 갔는지와 되돌리는 길**을 반드시 같이 보여 준다 (빈
// 화면만 남기면 터미널이 고장 난 것처럼 보인다).

interface TerminalAwayProps {
  projectId: number;
}

export function TerminalAway({ projectId }: TerminalAwayProps) {
  const { t } = useT();
  return (
    <div className="term-dock-away">
      <SquareTerminal size={22} color="var(--text-3)" />
      <p>{t("term.dock.awayTitle")}</p>
      <span>{t("term.dock.awayHint")}</span>
      <button type="button" className="btn" onClick={() => void commands.closeTerminalWindow(projectId)}>
        {t("term.dock.reattach")}
      </button>
    </div>
  );
}
