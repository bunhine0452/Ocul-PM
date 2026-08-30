// 모바일 Today — 오늘 일지 + 최근 플랜 업데이트 (#mb3-screens).
import { useCallback, useEffect, useState } from "react";

import { commands, type JournalEntrySummary, type PlanActivityDto } from "@/lib/bindings";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { todayWorkday } from "../workday";
import { ArrowRight } from "@/components/Icons";
import { AgentTag, EntryList, ErrorNote, Loading } from "./shared";

export function TodayTab({ projectId, onOpenEntry }: {
  projectId: number;
  onOpenEntry: (e: JournalEntrySummary) => void;
}) {
  const { t } = useT();
  const [entries, setEntries] = useState<JournalEntrySummary[] | null>(null);
  const [updates, setUpdates] = useState<PlanActivityDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [es, us] = await Promise.all([
      commands.oculpmListJournalEntries(projectId, todayWorkday(), null),
      commands.planRecentUpdates(projectId, 8),
    ]);
    if (es.status === "ok") setEntries(es.data);
    else setError(tError(es.error));
    if (us.status === "ok") setUpdates(us.data);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNote message={error} onRetry={() => void load()} />;
  if (entries === null) return <Loading />;

  // 히어로 스트립 — 데스크톱 Today 의 축약: 오늘 건수 + 타입 분포 칩.
  const byType = new Map<string, number>();
  for (const e of entries) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);

  return (
    <div className="space-y-5 p-4">
      <div className="mob-hero px-4 py-3.5 flex items-baseline gap-3">
        <span className="mob-hero-num text-2xl leading-none">{entries.length}</span>
        <span className="text-[13px] mob-text-2">{t("mobile.today.entries")}</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1">
          {[...byType.entries()].map(([type, n]) => (
            <span key={type} className={`mob-chip t-${type}`}>
              {n}
            </span>
          ))}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm mob-text-3 text-center py-4">{t("mobile.today.empty")}</p>
      ) : (
        <EntryList entries={entries} onOpen={onOpenEntry} />
      )}

      {updates.length > 0 ? (
        <section>
          <h2 className="mob-sec-title">{t("mobile.today.plans")}</h2>
          <ul className="space-y-2">
            {updates.map((u, i) => (
              <li key={i} className="mob-card px-3.5 py-2.5">
                <div className="text-[13px] font-medium">{u.item_title || u.item_id}</div>
                <div className="flex items-center gap-2 text-[11px] mob-text-3 mt-1">
                  <span className="truncate">{u.plan_title}</span>
                  <span className="inline-flex items-center gap-1">
                    {u.from_status ?? "·"} <ArrowRight size={11} aria-hidden /> {u.to_status ?? "·"}
                  </span>
                  <AgentTag agentId={u.agent_id} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
