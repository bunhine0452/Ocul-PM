import { SquareTerminal, ArrowRight, ChevronDown, ChevronRight } from "@/components/Icons";
import { TerminalInstance } from "@/features/terminal/TerminalInstance";

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
  return (
    <div className="card today-term">
      <div className="panel-head">
        <SquareTerminal size={16} color="var(--text-2)" />
        <h3>빠른 터미널</h3>
        <button
          type="button"
          className="btn ghost sm right"
          onClick={onFull}
          aria-label="전체 터미널 화면 열기"
        >
          전체 터미널 <ArrowRight size={13} />
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {open ? "접기" : "열기"}
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
            여기서 바로 에이전트를 실행하세요. 작업은 자동으로 일지에 기록됩니다.
          </div>
        </div>
      )}
    </div>
  );
}
