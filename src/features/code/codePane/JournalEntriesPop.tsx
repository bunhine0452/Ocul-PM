// 일지 팝오버 — 이 파일을 files_touched 로 만진 일지들. 항목 클릭은 일지 화면으로,
// diff 버튼은 인라인 비교로. `CodePane.tsx` 에서 그대로 들어냈다.
import type React from "react";

import type { FileJournalEntry } from "@/lib/bindings";
import { t } from "@/i18n";
import { GitCompareArrows } from "@/components/Icons";

interface Props {
  entries: FileJournalEntry[];
  setEntriesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openJournal: (journalPath: string) => void;
  enterEntryDiff: (entry: FileJournalEntry) => Promise<void>;
}

export function JournalEntriesPop({ entries, setEntriesOpen, openJournal, enterEntryDiff }: Props) {
  return (
    <div className="code-jrnl-pop" role="menu" aria-label={t("code.jrnl.title")}>
      <div className="code-jrnl-pop-head">{t("code.jrnl.title")}</div>
      {entries.map((entry) => (
        <div key={entry.journal_path} className="code-jrnl-row">
          <button
            type="button"
            className="code-jrnl-open"
            onClick={() => {
              setEntriesOpen(false);
              openJournal(entry.journal_path);
            }}
            title={t("code.jrnl.open")}
          >
            <span className={"code-jrnl-type t-" + entry.entry_type} aria-hidden />
            <span className="code-jrnl-title">{entry.title}</span>
            <span className="code-jrnl-meta">
              {entry.agent_id} · {entry.created_at.slice(5, 16).replace("T", " ")} · {entry.op}
            </span>
          </button>
          <button
            type="button"
            className="code-jrnl-diff"
            onClick={() => {
              setEntriesOpen(false);
              void enterEntryDiff(entry);
            }}
            title={t("code.jrnl.diff")}
            aria-label={t("code.jrnl.diff")}
          >
            <GitCompareArrows size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
