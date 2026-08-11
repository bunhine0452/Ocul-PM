import { Bot } from "@/components/Icons";
import { agentColor, agentLabel } from "./agentColor";
import type { AgentContribution } from "./useTodayBrief";
import { useT } from "@/i18n";

// Final UI Update (ui_v2) — per-agent contribution bars. Mirrors the
// `.agent-list` block in Ocul-PM1.0/src/today.jsx. Bar width is each agent's
// share of today's entries; swatch color is data-derived (agentColor).

export function AgentBreakdown({ agents }: { agents: AgentContribution[] }) {
  const { t } = useT();
  const total = Math.max(1, agents.reduce((s, a) => s + a.count, 0));
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <Bot size={16} color="var(--text-2)" />
        <h3>{t("today.agents.title")}</h3>
      </div>
      <div className="panel-body" style={{ padding: 10 }}>
        {agents.length === 0 ? (
          <div className="empty-hint" style={{ padding: 16 }}>
            {t("today.agents.empty")}
          </div>
        ) : (
          <div className="agent-list">
            {agents.map((a) => {
              const color = agentColor(a.id);
              return (
                <div className="agent-item" key={a.id}>
                  <span className="agent-swatch" style={{ background: color }} />
                  <span className="agent-name">{agentLabel(a.id)}</span>
                  <span className="agent-bar">
                    <i style={{ width: `${(a.count / total) * 100}%`, background: color }} />
                  </span>
                  <span className="agent-count">{a.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
