/**
 * 「오늘 한 일」 — 계획별로 묶고, 하루가 길면 묶음을 머리 한 줄로 접는다.
 *
 * 하루 60건이면 묶음 머리만 서고(검증 없는 것은 위 칸이 보여 준다), 3건이면 셋 다 보인다 —
 * 모드가 아니라 `todayModel.initialFold` 한 규칙이다. 묶음 머리를 누르면 펼치고 접는다.
 */

import { useState } from "react";

import { ChevronDown, ChevronRight } from "@/components/Icons";
import { TRIGGER_META } from "@/features/oculpm/triggerMeta";
import { useT } from "@/i18n";
import type { JournalEntrySummary, TodayDigest } from "@/lib/bindings";
import { clockOf } from "@/lib/whenLabel";
import { evidenceOf, FOLD_MIN, groupByPlan, initialFold, type GroupFold, type WorkGroup } from "./todayModel";

type WorkView = "plan" | "time";

function EntryRow({ entry, onOpen }: { entry: JournalEntrySummary; onOpen: (e: JournalEntrySummary) => void }) {
  const { t } = useT();
  const meta = TRIGGER_META[entry.type] ?? TRIGGER_META.chore;
  const ev = evidenceOf(entry);
  return (
    <li>
      <button type="button" className="tdy-ent" onClick={() => onOpen(entry)}>
        <span className="tdy-ent-tm mono">{clockOf(entry.created_at)}</span>
        <span className="tdy-ent-ty">
          <span className="tdy-dot" style={{ background: `var(--t-${meta.cssVar})` }} aria-hidden="true" />
          {t(meta.labelKey)}
        </span>
        <span className="tdy-ent-ti">{entry.title}</span>
        <span className={"tdy-ent-ev is-" + ev}>
          {ev === "command"
            ? t("today.work.evCommand")
            : ev === "verified"
              ? t("today.work.evVerified")
              : ev === "missing"
                ? t("today.work.evMissing")
                : "—"}
        </span>
        <span className="tdy-ent-ln mono">{t("today.work.files", { n: entry.files_count })}</span>
      </button>
    </li>
  );
}

function GroupHead({ group, open, onToggle }: { group: WorkGroup; open: boolean; onToggle: () => void }) {
  const { t } = useT();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <button type="button" className="tdy-grp" aria-expanded={open} onClick={onToggle}>
      <Chevron size={13} aria-hidden="true" />
      <b>{group.title ?? t("today.work.outside")}</b>
      <span className="tdy-meta">{t("today.work.count", { n: group.entries.length })}</span>
      <span className="tdy-sp" />
      {/* 예외 수만 (화면 검사 {#today-sum}) — 「검증 41 · 없음 4」 는 잡일처럼 검증 대상이 아닌
          일지를 어디에도 안 세서 합이 묶음 수와 맞지 않았다. */}
      {group.counts.missing > 0 ? <span className="tdy-warn">{t("today.work.missing", { n: group.counts.missing })}</span> : null}
    </button>
  );
}

interface TodayWorkProps {
  entries: JournalEntrySummary[];
  digest: TodayDigest;
  onOpenEntry: (e: JournalEntrySummary) => void;
}

export function TodayWork({ entries, digest, onOpenEntry }: TodayWorkProps) {
  const { t } = useT();
  const [view, setView] = useState<WorkView>("plan");
  // 사람이 누른 접힘만 기억한다 — 나머지는 매번 규칙(initialFold)이 정한다.
  const [folds, setFolds] = useState<Record<string, GroupFold>>({});
  const groups = groupByPlan(entries, digest);
  const flat = groups.length <= 1 && entries.length <= FOLD_MIN;

  const foldOf = (g: WorkGroup) => folds[g.key] ?? initialFold(entries.length);
  const toggle = (g: WorkGroup) => setFolds((prev) => ({ ...prev, [g.key]: foldOf(g) === "closed" ? "open" : "closed" }));

  return (
    <section className="card tdy-card" aria-labelledby="tdy-work-h">
      <header className="tdy-ch">
        <h2 id="tdy-work-h">{t("today.work.title")}</h2>
        <span className="tdy-cnt">{entries.length}</span>
        <span className="tdy-sp" />
        {groups.length > 1 ? (
          <div className="seg" role="tablist" aria-label={t("today.work.viewAria")}>
            {(["plan", "time"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                className="seg-item"
                aria-selected={view === v}
                onClick={() => setView(v)}
              >
                {v === "plan" ? t("today.work.byPlan") : t("today.work.byTime")}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      {flat || view === "time" ? (
        <ul className="tdy-ents">
          {entries.map((e) => (
            <EntryRow key={e.relative_path} entry={e} onOpen={onOpenEntry} />
          ))}
        </ul>
      ) : (
        groups.map((g) => {
          const fold = foldOf(g);
          const shown = fold === "open" ? g.entries : [];
          return (
            <div key={g.key} className="tdy-grp-wrap">
              <GroupHead group={g} open={fold !== "closed"} onToggle={() => toggle(g)} />
              {shown.length > 0 ? (
                <ul className="tdy-ents">
                  {shown.map((e) => (
                    <EntryRow key={e.relative_path} entry={e} onOpen={onOpenEntry} />
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}
