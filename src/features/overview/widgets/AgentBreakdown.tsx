/**
 * Agent contribution breakdown. Horizontal bars sorted by entry_count DESC.
 * Click → navigate to Today with that agent's entries filtered (wired in
 * W5-PR6; until then `navigateToToday` only carries the intent).
 */

import type { AgentCount } from "@/lib/bindings";
import { navigateToToday } from "@/lib/todayNavigate";

interface Props {
  agents: ReadonlyArray<AgentCount>;
}

const AGENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  antigravity: "Antigravity",
  "gemini-cli": "Gemini CLI",
  "agents-md": "AGENTS.md",
  manual: "수동",
  migrated: "마이그레이션",
};

function labelFor(id: string): string {
  return AGENT_LABELS[id] ?? id;
}

export function AgentBreakdown({ agents }: Props) {
  if (agents.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          에이전트 분포
        </h3>
        <div className="text-xs text-muted-foreground">
          아직 entries 가 없어요.
        </div>
      </div>
    );
  }
  const max = agents[0]?.entry_count ?? 1;
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        에이전트 분포
      </h3>
      <ul className="space-y-1.5">
        {agents.map((a) => {
          const widthPct = max > 0 ? (a.entry_count / max) * 100 : 0;
          return (
            <li key={a.agent_id}>
              <button
                type="button"
                onClick={() =>
                  navigateToToday({
                    kind: "filter",
                    filter: { agents: [a.agent_id] },
                  })
                }
                className="w-full group text-left"
                title={`${labelFor(a.agent_id)}: ${a.entry_count} (${(((a.share ?? 0) * 100)).toFixed(0)}%)`}
              >
                <div className="flex items-baseline justify-between text-xs mb-0.5">
                  <span className="font-medium group-hover:text-primary transition-colors">
                    {labelFor(a.agent_id)}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {a.entry_count}
                    <span className="ml-1 text-[10px] opacity-70">
                      {((a.share ?? 0) * 100).toFixed(0)}%
                    </span>
                  </span>
                </div>
                <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/70 group-hover:bg-primary transition-colors"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
