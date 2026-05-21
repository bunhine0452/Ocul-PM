import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Flame, FileDiff } from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import { commands, type ChangelogEntry, type ChangelogFileEntry } from "@/lib/bindings";
import { DiffModal } from "./DiffModal";
import { CategoryChip, truncate } from "./util";

// MASTER-GUIDE §5.5 — entry 디테일 패널.
// ChangelogScreen 우측 영역에서 사용. 동선:
//   1. 헤더(카테고리/시각/고정 토글)
//   2. 제목 + 사용자 의도
//   3. AI 요약 (마크다운)
//   4. 파일별 변경 — 행 클릭 시 DiffModal 으로 라인 단위 diff 표시.

interface EntryDetailProps {
  entry: ChangelogEntry;
  files: ChangelogFileEntry[];
  /** Bubble up the pinned-state change so the parent list can re-render. */
  onChange?: (updated: ChangelogEntry) => void;
}

export function EntryDetail({ entry, files, onChange }: EntryDetailProps) {
  const [openDiff, setOpenDiff] = useState<ChangelogFileEntry | null>(null);
  const [pinPending, setPinPending] = useState(false);

  async function togglePin() {
    setPinPending(true);
    const res = await commands.pinChangelog(entry.id);
    if (res.status === "ok") onChange?.(res.data);
    setPinPending(false);
  }

  return (
    <>
      <article className="p-6 max-w-3xl mx-auto space-y-5">
        <header className="border-b border-border pb-4">
          <div className="flex items-center gap-2 mb-2">
            {entry.category && <CategoryChip category={entry.category} />}
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {new Date(entry.created_at * 1000).toLocaleString("ko-KR")}
            </span>
            <Button
              onClick={togglePin}
              size="sm"
              variant={entry.pinned ? "default" : "outline"}
              disabled={pinPending}
              className="ml-auto"
            >
              <Flame className="w-3.5 h-3.5 mr-1.5" />
              {entry.pinned ? "고정 해제" : "고정"}
            </Button>
          </div>
          <h2 className="text-xl font-bold leading-tight">
            {entry.title ?? truncate(entry.ai_summary, 80)}
          </h2>
          {entry.user_intent && (
            <p className="text-xs text-muted-foreground mt-2">
              <span className="font-semibold">의도:</span> {entry.user_intent}
            </p>
          )}
        </header>

        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            AI 요약
          </h3>
          <Markdown>{entry.ai_summary}</Markdown>
        </section>

        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            파일별 변경 ({files.length})
          </h3>
          <ul className="space-y-1.5">
            {files.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setOpenDiff(f)}
                  className="w-full rounded-lg border border-border bg-card hover:bg-accent/40 hover:border-primary/40 p-3 text-xs text-left transition-colors cursor-pointer"
                  title="클릭하여 diff 보기"
                >
                  <div className="flex items-center gap-2">
                    <FileDiff className="w-3.5 h-3.5 text-muted-foreground" />
                    <code className="font-mono text-[11px] flex-1 truncate">
                      {f.file_path}
                    </code>
                    <span className="tabular-nums text-muted-foreground">
                      +{f.lines_added} / -{f.lines_removed}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {f.change_type}
                    </span>
                  </div>
                  {f.per_file_summary && (
                    <p className="text-muted-foreground mt-1.5 leading-snug">
                      {f.per_file_summary}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {entry.prompt_text && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
              원본 영어 프롬프트
            </summary>
            <pre className="mt-2 p-3 rounded-lg border border-border bg-secondary/30 whitespace-pre-wrap font-mono text-[11px]">
              {entry.prompt_text}
            </pre>
          </details>
        )}
      </article>

      <DiffModal file={openDiff} onClose={() => setOpenDiff(null)} />
    </>
  );
}
