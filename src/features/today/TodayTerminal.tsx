import { SquareTerminal, ArrowRight, ChevronDown, ChevronRight } from "@/components/Icons";
import { TerminalInstance } from "@/features/terminal/TerminalInstance";
import { useT } from "@/i18n";

// Today 빠른 터미널 — run an agent without leaving Today. Opt-in: the PTY only
// spawns once expanded (TerminalInstance mounts), and is killed on collapse /
// navigating away (fresh session next open — same volatile-PTY model as the
// full 터미널 화면). A dedicated session id keeps it independent of the tabbed
// 터미널 screen; "전체 터미널" hands off there for tabs/history.

interface TodayTerminalProps {
  projectRoot: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hand off to the full 터미널 화면 (⌘6). */
  onFull: () => void;
}

export function TodayTerminal({ projectRoot, open, onOpenChange, onFull }: TodayTerminalProps) {
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
            sessionId="today-quick"
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
