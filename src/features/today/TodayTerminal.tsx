import { SquareTerminal, ArrowRight, ChevronDown, ChevronRight } from "@/components/Icons";
import { TerminalInstance } from "@/features/terminal/TerminalInstance";
import { todayQuickSessionId } from "@/features/terminal/terminalLaunch";
import { useT } from "@/i18n";

// Today 빠른 터미널 — run an agent without leaving Today. Opt-in: the PTY only
// spawns once expanded (TerminalInstance mounts), and is killed on collapse /
// navigating away (fresh session next open — same volatile-PTY model as the
// full 터미널 화면). A dedicated session id keeps it independent of the tabbed
// 터미널 screen; "전체 터미널" hands off there for tabs/history.
//
// 그 세션 id 는 **프로젝트마다 하나**다 (`todayQuickSessionId`) — 고정 문자열을
// 쓰던 시절에는 프로젝트 탭 둘이 같은 셸을 나눠 갖고, 한쪽에서 접으면 다른 쪽
// 셸이 죽었다. 근거는 그 함수 주석에 적어 뒀다.

interface TodayTerminalProps {
  /** 세션 id 에 새길 주인. 프로젝트마다 자기 셸을 가진다 (교차 오염 방지). */
  projectId: number;
  projectRoot: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hand off to the full 터미널 화면 (⌘6). */
  onFull: () => void;
}

export function TodayTerminal({
  projectId,
  projectRoot,
  open,
  onOpenChange,
  onFull,
}: TodayTerminalProps) {
  const { t } = useT();
  return (
    <div className="card today-term">
      <div className="panel-head">
        <SquareTerminal size={16} color="var(--text-2)" />
        <h3>{t("today.terminal.title")}</h3>
        <button
          type="button"
          className="btn ghost sm right"
          onClick={onFull}
          aria-label={t("today.terminal.openFull")}
        >
          {t("today.terminal.full")} <ArrowRight size={13} />
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {open ? t("today.terminal.collapse") : t("today.terminal.expand")}
        </button>
      </div>

      {open ? (
        <div className="today-term-body">
          <TerminalInstance
            sessionId={todayQuickSessionId(projectId)}
            cwd={projectRoot ?? ""}
            visible
            fontSize={12.5}
          />
        </div>
      ) : (
        <div className="panel-body">
          <div className="empty-hint" style={{ padding: "16px" }}>
            {t("today.terminal.hint")}
          </div>
        </div>
      )}
    </div>
  );
}
