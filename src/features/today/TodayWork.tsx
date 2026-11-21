/**
 * 「오늘 한 일」 — 오른쪽 칸의 하나뿐인 카드. 계획별로 묶고, 하루가 길면 묶음을 머리 한 줄로 접는다.
 *
 * 하루 60건이면 묶음 머리만 서고(검증 없는 것은 왼쪽 칸이 보여 주고 머리는 「검증 없음 N」 으로만 말한다), 3건이면
 * 셋 다 보인다 — 모드가 아니라 `todayModel.initialFold` 한 규칙이다. 묶음 머리를 누르면 펼치고 접는다.
 * 검증 표시는 일지 화면과 같은 모양이다(`JournalRow` 의 `EvidenceMark` — 영수증 규칙 4): 통과는 회색 ✓,
 * 검증 없음은 호박 칩, 검증을 요구하지 않는 종류는 아무것도 없다.
 *
 * 편 목록(「시간순」 · 편 묶음)도 한 번에 `WORK_LIMIT` 줄까지만 그린다(11-22) — 하루 300건인 날 「시간순」 한 번이
 * 300줄(DOM 3,009개)을 세웠다. 나머지는 「N건 더 보기」 가 그만큼씩 더 그린다. 머리의 수는 늘 전부다.
 */

import { useLayoutEffect, useRef, useState } from "react";

import { ChevronDown, ChevronRight } from "@/components/Icons";
import { RadioSeg } from "@/components/RadioSeg";
import { evidenceStateOf } from "@/features/oculpm/evidenceState";
import { EvidenceMark } from "@/features/oculpm/JournalRow";
import { TRIGGER_META } from "@/features/oculpm/triggerMeta";
import { useT } from "@/i18n";
import type { JournalEntrySummary, TodayDigest } from "@/lib/bindings";
import { clockOf } from "@/lib/whenLabel";
import { FOLD_MIN, groupByPlan, initialFold, type GroupFold, type WorkGroup } from "./todayModel";

type WorkView = "plan" | "time";

/** 편 목록 하나가 한 번에 그리는 줄 수 — 넘는 만큼은 「N건 더 보기」 가 이만큼씩 더 그린다. */
export const WORK_LIMIT = 30;

function EntryRow({ entry, onOpen }: { entry: JournalEntrySummary; onOpen: (e: JournalEntrySummary) => void }) {
  const { t } = useT();
  const meta = TRIGGER_META[entry.type] ?? TRIGGER_META.chore;
  return (
    <li>
      <button type="button" className="tdy-ent" onClick={() => onOpen(entry)}>
        <span className="tdy-ent-tm mono">{clockOf(entry.created_at)}</span>
        <span className="tdy-ent-ty">{t(meta.labelKey)}</span>
        <span className="tdy-ent-ti">{entry.title}</span>
        <span className="tdy-ent-ev">
          <EvidenceMark state={evidenceStateOf(entry)} />
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
      <span className="tdy-sp" />
      {/* 예외는 「검증 없이 끝난 일지」 카드가 이미 세웠다 — 여기서는 그중 몇이 이 묶음인지만, 색 없이
          (영수증 규칙 1). 「검증 41 · 없음 4」 는 검증 대상이 아닌 일지를 어디에도 안 세서 합이 안 맞았다.
          그 카드는 넓은 창에선 왼쪽, 접힌 창에선 위라 자리(「위에」)로 가리키지 않는다. */}
      {group.counts.missing > 0 ? <span className="tdy-meta">{t("today.work.unverified", { n: group.counts.missing })}</span> : null}
      {/* 묶음 건수는 오른쪽 끝 한 칸 — 제목 길이를 따라 줄마다 다른 자리에 서지 않게. */}
      <span className="tdy-grp-n">{t("today.work.count", { n: group.entries.length })}</span>
    </button>
  );
}

/**
 * 편 목록 하나 — `WORK_LIMIT` 줄까지 그리고, 남으면 「N건 더 보기」 가 그만큼 더 그린다. 접었다 펴거나 보는 방식을
 * 바꾸면 처음 줄 수로 돌아간다(목록이 새로 선다). 손잡이를 키보드로 눌렀으면 포커스는 새로 그린 첫 줄로 간다 —
 * 마지막 묶음에서는 손잡이가 사라져 포커스가 body 로 떨어졌다.
 */
function EntryList({ entries, onOpen }: { entries: JournalEntrySummary[]; onOpen: (e: JournalEntrySummary) => void }) {
  const { t } = useT();
  const [limit, setLimit] = useState(WORK_LIMIT);
  const listRef = useRef<HTMLUListElement>(null);
  const focusAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = focusAt.current;
    if (at == null) return;
    focusAt.current = null;
    listRef.current?.querySelectorAll<HTMLElement>(".tdy-ent")[at]?.focus();
  }, [limit]);
  const shown = entries.length > limit ? entries.slice(0, limit) : entries;
  const hidden = entries.length - shown.length;
  return (
    <>
      <ul className="tdy-ents" ref={listRef}>
        {shown.map((e) => (
          <EntryRow key={e.relative_path} entry={e} onOpen={onOpen} />
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          className="tdy-more"
          onClick={(ev) => {
            if (document.activeElement === ev.currentTarget) focusAt.current = shown.length;
            setLimit((n) => n + WORK_LIMIT);
          }}
        >
          {t("journal.rowMore", { n: Math.min(WORK_LIMIT, hidden) })}
        </button>
      ) : null}
    </>
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
          // 보는 방식 둘 중 하나 — 변경 · 설정 · 일지와 같은 라디오 묶음(`RadioSeg`, 11-15 RC-19). 눌린 단추 둘이던
          // 때 화면 읽기에는 「전환 단추, 눌림」 이라 둘 중 하나인지 알 수 없었다.
          <RadioSeg<WorkView>
            label={t("today.work.viewAria")}
            value={view}
            options={[
              { id: "plan", label: t("today.work.byPlan") },
              { id: "time", label: t("today.work.byTime") },
            ]}
            onChange={setView}
          />
        ) : null}
      </header>
      {flat || view === "time" ? (
        <EntryList entries={entries} onOpen={onOpenEntry} />
      ) : (
        groups.map((g) => {
          const open = foldOf(g) === "open";
          return (
            <div key={g.key} className="tdy-grp-wrap">
              <GroupHead group={g} open={open} onToggle={() => toggle(g)} />
              {open && g.entries.length > 0 ? <EntryList entries={g.entries} onOpen={onOpenEntry} /> : null}
            </div>
          );
        })
      )}
    </section>
  );
}
