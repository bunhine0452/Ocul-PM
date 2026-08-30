// 모바일 일지 — 날짜 넘김 + 목록 + 수동 작성 (#mb3-screens).
import { useCallback, useEffect, useState } from "react";

import { commands, type EntryType, type JournalEntrySummary } from "@/lib/bindings";
import { ChevronLeft, ChevronRight, Plus } from "@/components/Icons";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { shiftWorkday, todayWorkday, workdayLabel } from "../workday";
import { EntryList, ErrorNote, Loading } from "./shared";

const ENTRY_TYPES: EntryType[] = ["feature", "bug", "error", "refactor", "chore"];

export function JournalTab({ projectId, onOpenEntry }: {
  projectId: number;
  onOpenEntry: (e: JournalEntrySummary) => void;
}) {
  const { t, lang } = useT();
  const [workday, setWorkday] = useState(todayWorkday());
  const [entries, setEntries] = useState<JournalEntrySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await commands.oculpmListJournalEntries(projectId, workday, null);
    if (res.status === "ok") setEntries(res.data);
    else setError(tError(res.error));
  }, [projectId, workday]);

  useEffect(() => {
    setEntries(null);
    void load();
  }, [load]);

  const isToday = workday === todayWorkday();

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setWorkday((w) => shiftWorkday(w, -1))}
          className="mob-btn-ghost px-3.5 py-1.5 text-sm"
          aria-label={t("mobile.journal.prevDay")}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => setWorkday(todayWorkday())}
          className={`mob-datebar-label text-sm ${isToday ? "is-today" : ""}`}
        >
          {isToday ? t("mobile.journal.today") : workdayLabel(workday, lang)}
        </button>
        <button
          onClick={() => setWorkday((w) => shiftWorkday(w, 1))}
          disabled={isToday}
          className="mob-btn-ghost px-3.5 py-1.5 text-sm disabled:opacity-30"
          aria-label={t("mobile.journal.nextDay")}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {error ? (
        <ErrorNote message={error} onRetry={() => void load()} />
      ) : entries === null ? (
        <Loading />
      ) : entries.length === 0 ? (
        <p className="text-sm mob-text-3 text-center py-8">{t("mobile.journal.empty")}</p>
      ) : (
        <EntryList entries={entries} onOpen={onOpenEntry} />
      )}

      {isToday ? (
        writing ? (
          <WriteForm
            projectId={projectId}
            onDone={() => {
              setWriting(false);
              void load();
            }}
            onCancel={() => setWriting(false)}
          />
        ) : (
          <button
            onClick={() => setWriting(true)}
            className="mob-btn-soft w-full py-3 text-sm inline-flex items-center justify-center gap-1.5"
          >
            <Plus size={15} /> {t("mobile.journal.write")}
          </button>
        )
      ) : null}
    </div>
  );
}

function slugify(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return ascii || `mobile-note-${todayWorkday()}`;
}

function WriteForm({ projectId, onDone, onCancel }: {
  projectId: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [type, setType] = useState<EntryType>("chore");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await commands.oculpmCreateManualEntry(projectId, {
      type,
      slug: slugify(title),
      title: title.trim(),
      difficulty: null,
      body_markdown: body.trim(),
      session_id: null,
      files_touched: [],
      status: "done",
      tags: ["mobile"],
    });
    setBusy(false);
    if (res.status === "ok") onDone();
    else setError(tError(res.error));
  };

  return (
    <div className="mob-card p-3.5 space-y-2.5">
      <div className="flex gap-1.5 overflow-x-auto">
        {ENTRY_TYPES.map((et) => (
          <button
            key={et}
            onClick={() => setType(et)}
            className={`mob-chip t-${et} shrink-0 ${type === et ? "" : "opacity-40"}`}
          >
            {et}
          </button>
        ))}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("mobile.journal.titlePlaceholder")}
        className="mob-input w-full px-3 py-2 text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("mobile.journal.bodyPlaceholder")}
        rows={4}
        className="mob-input w-full px-3 py-2 text-sm resize-none"
      />
      {error ? <p className="text-xs mob-danger whitespace-pre-wrap">{error}</p> : null}
      <div className="flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={!title.trim() || busy}
          className="mob-btn-primary flex-1 py-2 text-sm"
        >
          {t("mobile.journal.save")}
        </button>
        <button onClick={onCancel} className="mob-btn-ghost px-4 text-sm">
          {t("mobile.common.cancel")}
        </button>
      </div>
    </div>
  );
}
