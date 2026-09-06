import { useState } from "react";

import { ChevronDown, ChevronRight, GitCommitVertical, FileCode2, ListChecks, NotebookText } from "@/components/Icons";
import { SourceBadge } from "@/features/oculpm/SourceBadge";
import { sourceOfAgent } from "@/features/oculpm/entrySource";
import { useT, type I18nKey } from "@/i18n";
import type { BranchCommit, BranchEntry, BranchFile, BranchPlanItem } from "@/lib/bindings";

// 브랜치 이야기의 네 패널 (v3-surface {#branch-story-view}).
//
// 이 앱은 밀도 도구다 — 한 줄 = 한 사실. 회고의 `SignalsPanel` 어휘를 그대로
// 빌렸다 (`.card card-pad` · 배지 · 우측 메타). 히어로도 일러스트도 없다.

const TYPE_LABEL: Record<string, I18nKey> = {
  feature: "retro.type.feature",
  refactor: "retro.type.refactor",
  error: "retro.type.error",
  bug: "retro.type.bug",
};

/** "20260906" → "9/6". 회고의 `wd` 와 같은 규칙 — 좁은 폭에서 날짜는 짧아야 한다. */
export function wd(s: string): string {
  if (s.length !== 8) return s;
  return `${Number(s.slice(4, 6))}/${Number(s.slice(6, 8))}`;
}

export function Card({
  icon,
  title,
  count,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = collapsible ? open : true;
  const head = (
    <>
      <span className="text-muted-foreground">{icon}</span>
      {title}
      {count != null ? <span className="text-xs font-normal text-muted-foreground">{count}</span> : null}
    </>
  );
  return (
    <div className="card card-pad">
      {collapsible ? (
        <button
          type="button"
          className="mb-2.5 flex w-full items-center gap-1.5 text-sm font-semibold text-foreground"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {head}
        </button>
      ) : (
        <div className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">{head}</div>
      )}
      {shown ? children : null}
    </div>
  );
}

/** 일지 — 브랜치에 붙은 근거(`link`)를 행마다 밝힌다. 파생 판정은 이유가 있어야 한다. */
export function EntriesPanel({
  entries,
  onOpen,
}: {
  entries: BranchEntry[];
  onOpen: (relativePath: string) => void;
}) {
  const { t } = useT();
  return (
    <Card icon={<NotebookText size={15} />} title={t("branch.card.entries")} count={entries.length}>
      <ul className="flex flex-col gap-1.5">
        {entries.map((e) => (
          <li key={e.relative_path} className="flex items-baseline gap-2 text-sm">
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
              {t(TYPE_LABEL[e.entry_type] ?? "branch.type.other")}
            </span>
            <button
              type="button"
              className="flex-1 truncate text-left text-foreground hover:underline"
              onClick={() => onOpen(e.relative_path)}
              title={e.relative_path}
            >
              {e.title}
            </button>
            <span
              className="shrink-0 text-xs text-muted-foreground"
              title={t(e.link === "entry" ? "branch.link.entry.why" : "branch.link.files.why")}
            >
              {t(e.link === "entry" ? "branch.link.entry" : "branch.link.files")}
            </span>
            <SourceBadge source={sourceOfAgent(e.agent_id)} withLabel={false} />
            <span className="shrink-0 text-xs text-muted-foreground">{wd(e.workday)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** 플랜 — plan-log 의 `journal_ref` 만이 연결선이다. 추측으로 잇지 않는다. */
export function PlanPanel({ items }: { items: BranchPlanItem[] }) {
  const { t } = useT();
  return (
    <Card icon={<ListChecks size={15} />} title={t("branch.card.plans")} count={items.length}>
      <ul className="flex flex-col gap-1.5">
        {items.map((p) => (
          <li key={`${p.plan_id}/${p.item_id}`} className="flex items-baseline gap-2 text-sm">
            <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{p.plan_title}</span>
            <span className="flex-1 truncate text-foreground">{p.item_title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{p.status}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** 커밋 — 날짜별로 접어 읽는다. 한 줄 = 한 커밋. */
export function CommitsPanel({ commits }: { commits: BranchCommit[] }) {
  const { t } = useT();
  const days: { workday: string; rows: BranchCommit[] }[] = [];
  for (const c of commits) {
    const last = days[days.length - 1];
    if (last && last.workday === c.workday) last.rows.push(c);
    else days.push({ workday: c.workday, rows: [c] });
  }
  return (
    <Card
      icon={<GitCommitVertical size={15} />}
      title={t("branch.card.commits")}
      count={commits.length}
      collapsible
    >
      <div className="flex flex-col gap-3">
        {days.map((d) => (
          <div key={d.workday}>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{wd(d.workday)}</div>
            <ul className="flex flex-col gap-1.5">
              {d.rows.map((c) => (
                <li key={c.sha} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.short_sha}</span>
                  <span className="flex-1 truncate text-foreground">{c.subject}</span>
                  {c.journal_count > 0 ? (
                    <span className="shrink-0 rounded bg-(--ok-soft) px-1.5 py-0.5 text-[11px] font-medium text-(--ok-text)">
                      {t("branch.commit.journals", { n: c.journal_count })}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t("branch.commit.files", { n: c.file_count })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 파일 — 기록되지 않은 변경을 숨기지 않는다. 그게 이 화면의 정직성 축이다. */
export function FilesPanel({ files, onOpen }: { files: BranchFile[]; onOpen: (path: string) => void }) {
  const { t } = useT();
  const [onlyUnrecorded, setOnlyUnrecorded] = useState(false);
  const rows = onlyUnrecorded ? files.filter((f) => !f.recorded) : files;
  return (
    <Card icon={<FileCode2 size={15} />} title={t("branch.card.files")} count={files.length} collapsible>
      <button
        type="button"
        className="btn sm"
        aria-pressed={onlyUnrecorded}
        onClick={() => setOnlyUnrecorded((v) => !v)}
        style={{ marginBottom: 10 }}
      >
        {t("branch.files.onlyUnrecorded")}
      </button>
      <ul className="flex flex-col gap-1.5">
        {rows.map((f) => (
          <li key={f.path} className="flex items-center gap-2 text-sm">
            <button
              type="button"
              className="flex-1 truncate text-left font-mono text-xs text-foreground hover:underline"
              onClick={() => onOpen(f.path)}
              title={f.path}
            >
              {f.path}
            </button>
            {f.uncommitted ? (
              <span className="shrink-0 rounded bg-(--warn-soft) px-1.5 py-0.5 text-[11px] font-medium text-(--warn-text)">
                {t("branch.file.uncommitted")}
              </span>
            ) : null}
            {!f.recorded ? (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {t("branch.file.unrecorded")}
              </span>
            ) : null}
            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
              {f.commits > 0 ? `×${f.commits}` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
