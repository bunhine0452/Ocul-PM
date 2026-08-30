import { ErrorCard } from "@/components/ErrorCard";
import { requestReindex } from "@/lib/projectActions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  SearchIcon,
  SparklesIcon,
  Variable,
  CaseSensitive,
  Database,
  FileCode2,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  FileCode,
  X,
} from "@/components/Icons";
import { commands, type ChunkSearchResult, type SymbolSearchResult } from "@/lib/bindings";
import { useWorkspace, type SearchScope } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { OculSpinner } from "@/components/OculSpinner";
import { toast } from "@/lib/toast";
import { CodeSnippet } from "./CodeSnippet";
import { splitMatch, trimAroundMatch } from "./searchUtils";
import { t, useT, type I18nKey } from "@/i18n";
import { tError } from "@/i18n/errors";

// Final UI Update (ui_v2) — 코드 검색 화면 (02-screen-specs §5). PR-R1b (A2):
// all three scopes are live — 의미(searchChunks, 임베딩) / 심볼(searchSymbols,
// AST 인덱스) / 정확(searchText, FTS trigram). Each persists in
// WorkspaceContext.searchScope.
//
// 검색 업그레이드 라운드 (2026-08-16):
//   - 정확 검색: 파일별 그룹핑 + 매치 주변 ±5줄 트리밍(전체 보기 토글) +
//     스니펫 안 매치 <mark> 하이라이트. 통짜 청크 나열로 매치 위치가 안
//     보이던 것의 해법.
//   - 모든 결과에서 에디터로 해당 라인 점프 (open_in_editor 의 line 인자).
//   - 심볼: kind 필터 칩 + 이름 안 매치 하이라이트.
//   - 최근 검색어 8개 (WorkspaceContext.searchRecent — 선언만 있던 죽은
//     필드를 실제 배선).
//   - "결과 더 보기" (limit 20 → +30 씩).
//   - 레이스 픽스: 느린 이전 검색 응답이 최신 결과를 덮어쓰지 않게 seq 가드.

const SEARCH_LIMIT = 20;
const MORE_STEP = 30;
const RECENT_MAX = 8;

const SCOPES: {
  id: SearchScope;
  labelKey: I18nKey;
  icon: React.ComponentType<{ size?: number }>;
  placeholderKey: I18nKey;
}[] = [
  { id: "semantic", labelKey: "search.scope.semantic", icon: SparklesIcon, placeholderKey: "search.ph.semantic" },
  { id: "symbol", labelKey: "search.scope.symbol", icon: Variable, placeholderKey: "search.ph.symbol" },
  { id: "text", labelKey: "search.scope.text", icon: CaseSensitive, placeholderKey: "search.ph.text" },
];

// Discriminated by which command produced the results — `mode` distinguishes
// 의미(점수 표시) vs 정확(점수 없음) since both share ChunkSearchResult.
// `query` = 이 결과를 만든 검색어 (하이라이트/트리밍이 입력 중 쿼리에 안 흔들리게).
type Results =
  | { kind: "chunk"; mode: "semantic" | "text"; items: ChunkSearchResult[]; query: string }
  | { kind: "symbol"; items: SymbolSearchResult[]; query: string };

interface SearchScreenV2Props {
  projectId: number;
  /** 절대 프로젝트 루트 — 에디터 라인 점프(open_in_editor)에 필요. */
  projectRoot: string | null;
  /** 결과를 인앱 코드 화면으로 여는 핸드오프 (ShellV2 가 내려준다). */
  onOpenInCode?: (path: string, line: number | null) => void;
}

export function SearchScreenV2({ projectId, projectRoot, onOpenInCode }: SearchScreenV2Props) {
  useT();
  const { state, setState } = useWorkspace();
  // "결과 없음" 과 "색인 없음" 을 가른다 (완성도 라운드 Phase 2). 세 검색
  // 커맨드는 색인이 없어도 빈 배열을 돌려주므로 stats 를 따로 본다.
  const indexing = state.indexingProjectId === projectId;
  const indexProgress = state.indexProgress;
  const [chunkCount, setChunkCount] = useState<number | null>(null);
  useEffect(() => {
    if (indexing) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => commands.projectStats(projectId))
      .then((r) => {
        if (!cancelled && r.status === "ok") setChunkCount(r.data.chunks);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, indexing]);
  const noIndex = chunkCount === 0 && !indexing;
  const { settings } = useSettings();
  const scope = state.searchScope;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(SEARCH_LIMIT);
  // Feature 1 — pretty-print result code (Prettier / wasm-fmt). Defaults on;
  // "원본" shows the indexed text verbatim. 의미 검색 전용 — 정확 검색은
  // 트리밍/하이라이트가 원본 라인 기준이라 항상 원본으로 그린다.
  const [formatted, setFormatted] = useState(true);
  // 의미검색 문서 제외 — off by default so code hits aren't buried by docs.
  const [includeDocs, setIncludeDocs] = useState(false);
  // 심볼 kind 필터 (null = 전체). 새 검색마다 리셋.
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 레이스 가드 — 마지막으로 시작한 검색만 결과를 반영한다 (임베딩 검색은
  // 느릴 수 있어, 먼저 시작한 검색이 나중에 도착해 최신 결과를 덮어쓰던 것).
  const seqRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const pushRecent = useCallback(
    (q: string) => {
      setState((prev) => ({
        ...prev,
        searchRecent: [q, ...prev.searchRecent.filter((x) => x !== q)].slice(0, RECENT_MAX),
      }));
    },
    [setState],
  );

  const runSearch = useCallback(
    async (q: string, scopeArg: SearchScope, includeDocsArg: boolean, limitArg = SEARCH_LIMIT) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults(null);
        return;
      }
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      setLimit(limitArg);
      if (scopeArg === "symbol") {
        const res = await commands.searchSymbols(projectId, trimmed, limitArg);
        if (seq !== seqRef.current) return;
        if (res.status === "ok") {
          setResults({ kind: "symbol", items: res.data, query: trimmed });
          setKindFilter(null);
          if (res.data.length > 0) pushRecent(trimmed);
        } else {
          setResults(null);
          setError(tError(res.error));
        }
      } else {
        const res =
          scopeArg === "text"
            ? await commands.searchText(projectId, trimmed, limitArg)
            : await commands.searchChunks(projectId, trimmed, limitArg, includeDocsArg);
        if (seq !== seqRef.current) return;
        if (res.status === "ok") {
          setResults({
            kind: "chunk",
            mode: scopeArg === "text" ? "text" : "semantic",
            items: res.data,
            query: trimmed,
          });
          if (res.data.length > 0) pushRecent(trimmed);
        } else {
          setResults(null);
          setError(tError(res.error));
        }
      }
      if (seq === seqRef.current) setLoading(false);
    },
    [projectId, pushRecent],
  );

  // Switching scope re-runs the current query so results match the active mode.
  const onScope = (next: SearchScope) => {
    setState((prev) => ({ ...prev, searchScope: next }));
    if (query.trim()) void runSearch(query, next, includeDocs);
  };

  // Toggling "문서 포함" only affects semantic search — re-run when on it.
  const onToggleDocs = (next: boolean) => {
    setIncludeDocs(next);
    if (query.trim() && scope === "semantic") void runSearch(query, scope, next);
  };

  // 에디터 라인 점프 — 검색 결과의 실질적 목적지. line=null 이면 파일만 연다.
  const openAt = useCallback(
    async (path: string, line: number | null) => {
      if (!projectRoot) return;
      const res = await commands.openInEditor(projectRoot, path, settings.externalEditorCommand, line);
      if (res.status === "error") toast.destructive(t("diff.editorFailed", { error: res.error }));
    },
    [projectRoot, settings.externalEditorCommand],
  );

  // ⌘F focuses input, ⌘N clears (01-ia-and-shell §3). Screen-local; stop
  // propagation so the global handler doesn't also act.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.focus();
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        e.stopPropagation();
        setQuery("");
        setResults(null);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query, scope, includeDocs);
  };

  // 정확 검색 — 파일별 그룹핑 (백엔드가 path 순 정렬로 주므로 안정적).
  const textGroups = useMemo(() => {
    if (results?.kind !== "chunk" || results.mode !== "text") return null;
    const m = new Map<string, ChunkSearchResult[]>();
    for (const r of results.items) {
      (m.get(r.file_path) ?? m.set(r.file_path, []).get(r.file_path)!).push(r);
    }
    return [...m.entries()];
  }, [results]);

  const symbolKinds = useMemo(() => {
    if (results?.kind !== "symbol") return [];
    return [...new Set(results.items.map((i) => i.kind))].sort();
  }, [results]);
  const symbolItems = useMemo(() => {
    if (results?.kind !== "symbol") return [];
    return kindFilter == null
      ? results.items
      : results.items.filter((i) => i.kind === kindFilter);
  }, [results, kindFilter]);

  const show = query.trim().length > 0 && results != null;
  const activeScope = SCOPES.find((s) => s.id === scope) ?? SCOPES[0];
  // 결과가 limit 에 꽉 찼으면 더 있을 수 있다 — "더 보기"로 limit 상향 재검색.
  const canMore = results != null && results.items.length >= limit;

  return (
    <>
      <Toolbar title={t("nav.search")} sub={t("search.localIndex")}>
        <span className="chip">
          <Database size={13} /> {t("search.localIndex")}
        </span>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in">
          <div className="search-hero">
            <form className="search-big" onSubmit={onSubmit}>
              <SearchIcon size={19} color="var(--text-3)" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search.inputPlaceholder", { ph: t(activeScope.placeholderKey) })}
                aria-label={t("search.aria")}
              />
              {query ? (
                <button
                  type="button"
                  className="iconbtn"
                  onClick={() => {
                    setQuery("");
                    setResults(null);
                  }}
                  aria-label={t("journal.clearSearch")}
                >
                  <X size={15} />
                </button>
              ) : null}
            </form>
            <div className="search-scope">
              {SCOPES.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={"scope-chip" + (scope === s.id ? " on" : "")}
                    onClick={() => onScope(s.id)}
                  >
                    <Icon size={13} /> {t(s.labelKey)}
                  </button>
                );
              })}
              {scope === "semantic" ? (
                <button
                  type="button"
                  className={"scope-chip" + (includeDocs ? " on" : "")}
                  onClick={() => onToggleDocs(!includeDocs)}
                  title={t("search.includeDocsTitle")}
                  style={{ marginLeft: "auto" }}
                >
                  <FileCode2 size={13} /> {t("search.includeDocs")}
                </button>
              ) : null}
            </div>
            {/* 최근 검색 — 입력이 비어 있을 때만. 클릭 = 즉시 재검색. */}
            {!query.trim() && state.searchRecent.length > 0 ? (
              <div className="search-recent">
                <span className="search-recent-label">{t("search.recent")}</span>
                {state.searchRecent.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="scope-chip"
                    onClick={() => {
                      setQuery(q);
                      void runSearch(q, scope, includeDocs);
                    }}
                  >
                    {q}
                  </button>
                ))}
                <button
                  type="button"
                  className="iconbtn"
                  title={t("search.clearRecent")}
                  aria-label={t("search.clearRecent")}
                  onClick={() => setState((prev) => ({ ...prev, searchRecent: [] }))}
                >
                  <X size={13} />
                </button>
              </div>
            ) : null}
          </div>

          {error ? (
            <ErrorCard
              title={t("search.failed")}
              error={error}
              onRetry={() => void runSearch(query, scope, includeDocs)}
              style={{ maxWidth: 880, margin: "0 auto" }}
            />
          ) : loading ? (
            <OculSpinner label={t("search.searching")} />
          ) : noIndex ? (
            <NoIndexHint />
          ) : indexing ? (
            <div className="empty-hint">
              {indexProgress && indexProgress.total > 0
                ? t("search.indexing", { done: indexProgress.current, total: indexProgress.total })
                : t("search.indexingNoCount")}
            </div>
          ) : show && results!.items.length === 0 ? (
            <div className="empty-hint">{t("search.noResults")}</div>
          ) : show && results!.kind === "symbol" ? (
            <div className="search-results">
              <div className="section-title search-results-bar">
                <span>{t("search.symbolCount", { n: symbolItems.length })}</span>
                <span style={{ flex: 1 }} />
                {symbolKinds.length > 1 ? (
                  <div className="search-kinds" role="group" aria-label={t("search.kindAria")}>
                    <button
                      type="button"
                      className={"scope-chip sm" + (kindFilter == null ? " on" : "")}
                      onClick={() => setKindFilter(null)}
                    >
                      {t("search.kindAll")}
                    </button>
                    {symbolKinds.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={"scope-chip sm" + (kindFilter === k ? " on" : "")}
                        onClick={() => setKindFilter((prev) => (prev === k ? null : k))}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {symbolItems.map((r, i) => (
                <SymbolResult
                  key={`${r.file_path}:${r.start_line}:${r.name}:${i}`}
                  projectId={projectId}
                  r={r}
                  query={results!.query}
                  canOpen={!!projectRoot}
                  onOpen={() => void openAt(r.file_path, r.start_line)}
                  onOpenApp={
                    onOpenInCode ? () => onOpenInCode(r.file_path, r.start_line) : undefined
                  }
                />
              ))}
            </div>
          ) : show && textGroups ? (
            /* 정확 검색 — 파일 그룹 카드: 헤더(경로·일치 수·열기) + 매치 주변
               트리밍 스니펫들. */
            <div className="search-results">
              <div className="section-title" style={{ marginBottom: 12 }}>
                {t("search.resultCount", { n: results!.items.length })}
                {t("search.byExact")}
                {t("search.inFiles", { n: textGroups.length })}
              </div>
              {textGroups.map(([path, items]) => (
                <div className="card sresult" key={path}>
                  <div className="sresult-head" style={{ cursor: "default" }}>
                    <FileCode2 size={15} color="var(--text-2)" />
                    <span className="sresult-path">{path}</span>
                    <span className="sym-kind">{t("search.hitsInFile", { n: items.length })}</span>
                    <span className="sresult-lines">
                      {onOpenInCode ? (
                        <button
                          type="button"
                          className="sresult-open"
                          title={t("code.openInCode")}
                          onClick={() => onOpenInCode(path, items[0].start_line)}
                        >
                          <FileCode size={13} />
                        </button>
                      ) : null}
                      {projectRoot ? (
                        <button
                          type="button"
                          className="sresult-open"
                          title={t("search.openAtLine", { n: items[0].start_line })}
                          onClick={() => void openAt(path, items[0].start_line)}
                        >
                          <ExternalLink size={13} />
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {items.map((r) => (
                    <TextHit
                      key={r.chunk_id}
                      r={r}
                      query={results!.query}
                      canOpen={!!projectRoot}
                      onOpen={(line) => void openAt(r.file_path, line)}
                      onOpenApp={
                        onOpenInCode ? (line) => onOpenInCode(r.file_path, line) : undefined
                      }
                    />
                  ))}
                </div>
              ))}
              {canMore ? (
                <MoreButton onClick={() => void runSearch(results!.query, scope, includeDocs, limit + MORE_STEP)} />
              ) : null}
            </div>
          ) : show ? (
            /* 의미 검색 — 유사도순 flat 카드 (점수 바 + 정렬/원본 토글). */
            <div className="search-results">
              <div className="section-title search-results-bar">
                <span>
                  {t("search.resultCount", { n: results!.items.length })}
                  {t("search.bySimilarity")}
                </span>
                <span style={{ flex: 1 }} />
                <div className="diff-mode-toggle" role="group" aria-label={t("search.displayAria")}>
                  {([true, false] as const).map((on) => (
                    <button
                      key={String(on)}
                      type="button"
                      className="btn ghost sm"
                      style={{
                        background: formatted === on ? "var(--accent-soft)" : "transparent",
                        color: formatted === on ? "var(--accent-text)" : "var(--text-2)",
                      }}
                      onClick={() => setFormatted(on)}
                      aria-pressed={formatted === on}
                    >
                      {on ? t("search.formatted") : t("search.raw")}
                    </button>
                  ))}
                </div>
              </div>
              {(results as { items: ChunkSearchResult[] }).items.map((r) => (
                <div className="card sresult" key={`${r.chunk_id}`}>
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
                      {projectRoot ? (
                        <button
                          type="button"
                          className="sresult-open"
                          title={t("search.openAtLine", { n: r.start_line })}
                          onClick={() => void openAt(r.file_path, r.start_line)}
                        >
                          <ExternalLink size={13} />
                        </button>
                      ) : null}
                    </span>
                    {r.distance != null ? (
                      <div className="score" style={{ marginLeft: 14 }}>
                        <div className="score-bar">
                          <i style={{ width: `${Math.max(0, Math.min(1, 1 - r.distance)) * 100}%` }} />
                        </div>
                        {Math.round(Math.max(0, Math.min(1, 1 - r.distance)) * 100)}%
                      </div>
                    ) : null}
                  </div>
                  <CodeSnippet path={r.file_path} content={r.content} formatted={formatted} />
                </div>
              ))}
              {canMore ? (
                <MoreButton onClick={() => void runSearch(results!.query, scope, includeDocs, limit + MORE_STEP)} />
              ) : null}
            </div>
          ) : (
            <div className="empty-hint">{hint(scope)}</div>
          )}
        </div>
      </div>
    </>
  );
}

/** 정확 검색 히트 하나 — 매치 주변 ±5줄 트리밍 + 전체 보기 토글 + 라인 점프. */
function TextHit({
  r,
  query,
  canOpen,
  onOpen,
  onOpenApp,
}: {
  r: ChunkSearchResult;
  query: string;
  canOpen: boolean;
  onOpen: (line: number) => void;
  onOpenApp?: (line: number) => void;
}) {
  useT();
  const [full, setFull] = useState(false);
  const trim = useMemo(() => trimAroundMatch(r.content, query), [r.content, query]);
  const fromL = r.start_line + trim.fromLine;
  const toL = r.start_line + trim.toLine;
  const matchL = trim.matchLine != null ? r.start_line + trim.matchLine : r.start_line;
  return (
    <div className="sresult-hit">
      <div className="sresult-hit-bar">
        <span className="sresult-lines" style={{ marginLeft: 0 }}>
          {full ? `L${r.start_line}–${r.end_line}` : `L${fromL}–${toL}`}
        </span>
        {trim.truncated ? (
          <button type="button" className="lnk" onClick={() => setFull((v) => !v)}>
            {full ? t("search.showTrimmed") : t("search.showFull", { n: trim.totalLines })}
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        {onOpenApp ? (
          <button
            type="button"
            className="sresult-open"
            title={t("code.openInCode")}
            onClick={() => onOpenApp(matchL)}
          >
            <FileCode size={13} />
          </button>
        ) : null}
        {canOpen ? (
          <button
            type="button"
            className="sresult-open"
            title={t("search.openAtLine", { n: matchL })}
            onClick={() => onOpen(matchL)}
          >
            <ExternalLink size={13} />
          </button>
        ) : null}
      </div>
      <CodeSnippet
        path={r.file_path}
        content={full ? r.content : trim.text}
        formatted={false}
        highlightQuery={query}
      />
    </div>
  );
}

// A single symbol hit. The row header is a button that toggles the function /
// class body open; the code is fetched lazily on first expand (read_file_range)
// so a 20-symbol result list doesn't pull 20 file ranges up front.
function SymbolResult({
  projectId,
  r,
  query,
  canOpen,
  onOpen,
  onOpenApp,
}: {
  projectId: number;
  r: SymbolSearchResult;
  query: string;
  canOpen: boolean;
  onOpen: () => void;
  onOpenApp?: () => void;
}) {
  useT();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && code == null && !loading) {
      setLoading(true);
      setErr(null);
      const res = await commands.readFileRange(projectId, r.file_path, r.start_line, r.end_line);
      if (res.status === "ok") setCode(res.data);
      else setErr(tError(res.error));
      setLoading(false);
    }
  };

  return (
    <div className="card sresult">
      <div className="sresult-head" style={{ padding: 0 }}>
        <button
          type="button"
          className="sresult-symrow"
          onClick={() => void toggle()}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown size={14} color="var(--text-3)" />
          ) : (
            <ChevronRight size={14} color="var(--text-3)" />
          )}
          <Variable size={15} color="var(--text-2)" />
          <span className="sresult-path">
            <strong>
              {splitMatch(r.name, query).map((seg, i) =>
                seg.hit ? <mark className="s-hit" key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>,
              )}
            </strong>
            <span className="sym-kind">{r.kind}</span>
          </span>
          <span className="sresult-lines">
            {r.file_path} · L{r.start_line}–{r.end_line}
          </span>
        </button>
        {onOpenApp ? (
          <button
            type="button"
            className="sresult-open"
            title={t("code.openInCode")}
            onClick={onOpenApp}
          >
            <FileCode size={13} />
          </button>
        ) : null}
        {canOpen ? (
          <button
            type="button"
            className="sresult-open"
            style={{ marginRight: 12 }}
            title={t("search.openAtLine", { n: r.start_line })}
            onClick={onOpen}
          >
            <ExternalLink size={13} />
          </button>
        ) : null}
      </div>
      {open ? (
        loading ? (
          <div className="scode" style={{ color: "var(--text-3)" }}>{t("common.loading")}</div>
        ) : err ? (
          <div className="scode" style={{ color: "var(--t-bug)" }}>{err}</div>
        ) : code != null ? (
          <CodeSnippet path={r.file_path} content={code} formatted={false} highlightQuery={query} />
        ) : null
      ) : null}
    </div>
  );
}

function MoreButton({ onClick }: { onClick: () => void }) {
  useT();
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
      <button type="button" className="btn ghost" onClick={onClick}>
        {t("search.more")}
      </button>
    </div>
  );
}

function hint(scope: SearchScope): string {
  if (scope === "symbol") return t("search.hintSymbol");
  if (scope === "text") return t("search.hintText");
  return t("search.hintSemantic");
}

/** 색인이 없을 때의 빈 상태 — 검색어를 치기 전에도 보인다. */
function NoIndexHint() {
  const { t } = useT();
  return (
    <div className="empty-hint search-noindex">
      <div className="search-noindex-title">{t("search.noIndex")}</div>
      <div>{t("search.noIndexHint")}</div>
      <button className="btn primary sm" onClick={requestReindex}>
        {t("search.buildIndex")}
      </button>
    </div>
  );
}
