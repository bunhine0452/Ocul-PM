import type { ChunkSearchResult, EntryType } from "@/lib/bindings";
import { FileCode2, FileCode, ExternalLink } from "@/components/Icons";
import { TriggerBadge } from "@/features/oculpm/triggerMeta";
import { CodeSnippet } from "./CodeSnippet";
import { useT } from "@/i18n";

// 의미검색 결과 리스트 (journal-scale-round {#search-semantic-journal}).
//
// SearchScreenV2.tsx 에서 갈라 나온 이유는 `JournalScopeResults` 와 같다 —
// 기능이 아니라 예산(파일 크기 래칫 800줄)이다. 갈라 나오면서 일지 행이
// 붙었다: `kind === "journal"` 인 청크는 파일 경로가 아니라 **제목과 종류
// 배지**로 그리고, 클릭하면 일지 화면으로 간다.
//
// 그 셋(제목·종류·워크데이)은 백엔드가 청크 **첫 줄**에 심어 보낸다
// (`journal_index::header_line`: `# 제목 · type: bug · tags: … · workday: …`).
// 새 커맨드를 파거나 결과 타입에 필드를 더 붙이는 대신 그 줄을 읽는 이유는,
// 그 줄이 이미 임베딩 품질을 위해 **반드시** 있어야 하는 것이기 때문이다.

const JOURNAL_PREFIX = ".oculpm/journal/";
const ENTRY_TYPES = new Set<string>(["bug", "feature", "error", "refactor", "chore"]);

export interface JournalChunkMeta {
  /** 일지 화면 핸드오프용 — `.oculpm/journal/` 을 뗀 상대 경로. */
  entryPath: string | null;
  title: string;
  entryType: string | null;
  workday: string | null;
  /** 머리말 줄을 뗀 본문 — 스니펫에 머리말이 두 번 보이지 않게. */
  body: string;
}

/** 일지 청크의 머리말 줄을 읽어 제목·종류·워크데이로 가른다. */
export function parseJournalChunk(r: ChunkSearchResult): JournalChunkMeta {
  const nl = r.content.indexOf("\n");
  const head = (nl === -1 ? r.content : r.content.slice(0, nl)).replace(/^#\s*/, "");
  const body = nl === -1 ? "" : r.content.slice(nl + 1);
  const parts = head.split(" · ");
  let title = parts[0]?.trim() ?? "";
  let entryType: string | null = null;
  let workday: string | null = null;
  for (const p of parts.slice(1)) {
    const seg = p.trim();
    if (seg.startsWith("type: ")) entryType = seg.slice(6).trim();
    else if (seg.startsWith("workday: ")) workday = seg.slice(9).trim();
  }
  if (!title) title = r.file_path;
  const entryPath = r.file_path.startsWith(JOURNAL_PREFIX)
    ? r.file_path.slice(JOURNAL_PREFIX.length)
    : null;
  return { entryPath, title, entryType, workday, body };
}

interface SemanticResultsProps {
  items: ChunkSearchResult[];
  /** 「일지 N건 포함」 — 이 결과 안의 일지 청크 수. 0 이면 표기하지 않는다. */
  journalCount: number;
  formatted: boolean;
  onFormatted: (v: boolean) => void;
  canOpenInEditor: boolean;
  onOpenAt: (path: string, line: number) => void;
  onOpenInCode?: (path: string, line: number) => void;
  /** 일지 화면 이동 (없으면 일지 행도 코드/에디터로만 연다). */
  onOpenJournal?: (entryPath: string) => void;
  canMore: boolean;
  onMore: () => void;
}

export function SemanticResults({
  items,
  journalCount,
  formatted,
  onFormatted,
  canOpenInEditor,
  onOpenAt,
  onOpenInCode,
  onOpenJournal,
  canMore,
  onMore,
}: SemanticResultsProps) {
  const { t } = useT();
  return (
    <div className="search-results">
      <div className="section-title search-results-bar">
        <span>
          {t("search.resultCount", { n: items.length })}
          {t("search.bySimilarity")}
          {journalCount > 0 ? t("search.journalIncluded", { n: journalCount }) : null}
        </span>
        <span style={{ flex: 1 }} />
        <div className="seg" role="tablist" aria-label={t("search.displayAria")}>
          {([true, false] as const).map((on) => (
            <button
              key={String(on)}
              type="button"
              role="tab"
              aria-selected={formatted === on}
              className="seg-item"
              onClick={() => onFormatted(on)}
            >
              {on ? t("search.formatted") : t("search.raw")}
            </button>
          ))}
        </div>
      </div>
      {items.map((r) =>
        r.kind === "journal" ? (
          <JournalChunkCard
            key={r.chunk_id}
            r={r}
            onOpenJournal={onOpenJournal}
            onOpenInCode={onOpenInCode}
            canOpenInEditor={canOpenInEditor}
            onOpenAt={onOpenAt}
          />
        ) : (
          <div className="card sresult" key={r.chunk_id}>
            <div className="sresult-head" style={{ cursor: "default" }}>
              <FileCode2 size={15} color="var(--text-2)" />
              <span className="sresult-path">{r.file_path}</span>
              <span className="sresult-lines">
                L{r.start_line}–{r.end_line}
                {onOpenInCode ? (
                  <button
                    type="button"
                    className="sresult-open"
                    title={t("code.openInCode")}
                    onClick={() => onOpenInCode(r.file_path, r.start_line)}
                  >
                    <FileCode size={13} />
                  </button>
                ) : null}
                {canOpenInEditor ? (
                  <button
                    type="button"
                    className="sresult-open"
                    title={t("search.openAtLine", { n: r.start_line })}
                    onClick={() => onOpenAt(r.file_path, r.start_line)}
                  >
                    <ExternalLink size={13} />
                  </button>
                ) : null}
              </span>
              <Score distance={r.distance} />
            </div>
            <CodeSnippet path={r.file_path} content={r.content} formatted={formatted} />
          </div>
        ),
      )}
      {canMore ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
          <button type="button" className="btn ghost" onClick={onMore}>
            {t("search.more")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 일지·롤업 청크 한 행 — 파일 카드가 아니라 일지 카드로 그린다. */
function JournalChunkCard({
  r,
  onOpenJournal,
  onOpenInCode,
  canOpenInEditor,
  onOpenAt,
}: {
  r: ChunkSearchResult;
  onOpenJournal?: (entryPath: string) => void;
  onOpenInCode?: (path: string, line: number) => void;
  canOpenInEditor: boolean;
  onOpenAt: (path: string, line: number) => void;
}) {
  const { t } = useT();
  const meta = parseJournalChunk(r);
  // 일지는 일지 화면으로, 롤업(`.oculpm/rollups/**`)은 일지 항목이 아니라
  // 주간 문서라 코드/에디터로 연다 — 없는 목적지를 만들지 않는다.
  const openEntry = meta.entryPath && onOpenJournal ? () => onOpenJournal(meta.entryPath!) : null;
  const openElsewhere = onOpenInCode
    ? () => onOpenInCode(r.file_path, r.start_line)
    : canOpenInEditor
      ? () => onOpenAt(r.file_path, r.start_line)
      : null;
  const onClick = openEntry ?? openElsewhere;
  return (
    <div className="card sresult">
      <div className="sresult-head" style={{ padding: 0 }}>
        <button
          type="button"
          className="sresult-symrow"
          disabled={onClick == null}
          onClick={() => onClick?.()}
        >
          {meta.entryType && ENTRY_TYPES.has(meta.entryType) ? (
            <TriggerBadge type={meta.entryType as EntryType} withLabel={false} />
          ) : null}
          <span className="sresult-path">{meta.title}</span>
          <span className="sym-kind">{t("search.journalBadge")}</span>
          <span className="sresult-lines">
            {meta.workday ?? r.file_path}
            <Score distance={r.distance} />
          </span>
        </button>
      </div>
      <div className="scode" style={{ whiteSpace: "pre-wrap" }}>
        {meta.body}
      </div>
    </div>
  );
}

function Score({ distance }: { distance: number | null }) {
  if (distance == null) return null;
  const pct = Math.max(0, Math.min(1, 1 - distance));
  return (
    <div className="score" style={{ marginLeft: 14 }}>
      <div className="score-bar">
        <i style={{ width: `${pct * 100}%` }} />
      </div>
      {Math.round(pct * 100)}%
    </div>
  );
}
