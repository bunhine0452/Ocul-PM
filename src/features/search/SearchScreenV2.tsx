import { useCallback, useEffect, useRef, useState } from "react";
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
  X,
  TriangleAlert,
} from "@/components/Icons";
import { commands, type ChunkSearchResult, type SymbolSearchResult } from "@/lib/bindings";
import { useWorkspace, type SearchScope } from "@/contexts/WorkspaceContext";
import { OculSpinner } from "@/components/OculSpinner";
import { CodeSnippet } from "./CodeSnippet";
import { t, useT, type I18nKey } from "@/i18n";

// Final UI Update (ui_v2) — 코드 검색 화면 (02-screen-specs §5). PR-R1b (A2):
// all three scopes are live — 의미(searchChunks, 임베딩) / 심볼(searchSymbols,
// AST 인덱스) / 정확(searchText, chunk content LIKE). Each persists in
// WorkspaceContext.searchScope. (Was: only 의미; symbol/text disabled "1.1".)
//
// Code-search round (2026-06-15):
//   - 의미검색 문서 제외 — semantic search hides prose files (.md/.txt/…) by
//     default; a "문서 포함" chip opts them back in.
//   - 심볼 펼침 — symbol hits expand to show the function/class body, fetched
//     lazily via read_file_range.

const SEARCH_LIMIT = 20;

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
type Results =
  | { kind: "chunk"; mode: "semantic" | "text"; items: ChunkSearchResult[] }
  | { kind: "symbol"; items: SymbolSearchResult[] };

interface SearchScreenV2Props {
  projectId: number;
}

export function SearchScreenV2({ projectId }: SearchScreenV2Props) {
  useT();
  const { state, setState } = useWorkspace();
  const scope = state.searchScope;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Feature 1 — pretty-print result code (Prettier / wasm-fmt). Defaults on;
  // "원본" shows the indexed text verbatim for snippets that don't format well.
  const [formatted, setFormatted] = useState(true);
  // 의미검색 문서 제외 — off by default so code hits aren't buried by docs.
  const [includeDocs, setIncludeDocs] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(
    async (q: string, scopeArg: SearchScope, includeDocsArg: boolean) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults(null);
        return;
      }
      setLoading(true);
      setError(null);
      if (scopeArg === "symbol") {
        const res = await commands.searchSymbols(projectId, trimmed, SEARCH_LIMIT);
        if (res.status === "ok") setResults({ kind: "symbol", items: res.data });
        else {
          setResults(null);
          setError(res.error);
        }
      } else {
        const res =
          scopeArg === "text"
            ? await commands.searchText(projectId, trimmed, SEARCH_LIMIT)
            : await commands.searchChunks(projectId, trimmed, SEARCH_LIMIT, includeDocsArg);
        if (res.status === "ok") {
          setResults({ kind: "chunk", mode: scopeArg === "text" ? "text" : "semantic", items: res.data });
        } else {
          setResults(null);
          setError(res.error);
        }
      }
      setLoading(false);
    },
    [projectId],
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

  const show = query.trim().length > 0 && results != null;
  const activeScope = SCOPES.find((s) => s.id === scope) ?? SCOPES[0];

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
          </div>

          {error ? (
            <div className="card card-pad" style={{ maxWidth: 880, margin: "0 auto" }}>
              <div className="stat-top" style={{ color: "var(--t-bug)" }}>
                <TriangleAlert size={14} /> {t("search.failed")}
              </div>
              <div className="today-date" style={{ marginTop: 8 }}>{error}</div>
            </div>
          ) : loading ? (
            <OculSpinner label={t("search.searching")} />
          ) : show && resultCount(results!) === 0 ? (
            <div className="empty-hint">{t("search.noResults")}</div>
          ) : show && results!.kind === "symbol" ? (
            <div className="search-results">
              <div className="section-title" style={{ marginBottom: 12 }}>
                {t("search.symbolCount", { n: results!.items.length })}
              </div>
              {results!.items.map((r, i) => (
                <SymbolResult
                  key={`${r.file_path}:${r.start_line}:${r.name}:${i}`}
                  projectId={projectId}
                  r={r}
                />
              ))}
            </div>
          ) : show ? (
            <div className="search-results">
              <div
                className="section-title"
                style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}
              >
                <span>
                  {t("search.resultCount", { n: results!.items.length })}
                  {results!.kind === "chunk" && results!.mode === "semantic"
                    ? t("search.bySimilarity")
                    : t("search.byExact")}
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
              {(results as { items: ChunkSearchResult[]; mode: string }).items.map((r) => (
                <div className="card sresult" key={`${r.chunk_id}`}>
                  <div className="sresult-head">
                    <FileCode2 size={15} color="var(--text-2)" />
                    <span className="sresult-path">{r.file_path}</span>
                    <span className="sresult-lines">
                      L{r.start_line}–{r.end_line}
                    </span>
                    {results!.kind === "chunk" && results!.mode === "semantic" && r.distance != null ? (
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
            </div>
          ) : (
            <div className="empty-hint">{hint(scope)}</div>
          )}
        </div>
      </div>
    </>
  );
}

// A single symbol hit. The row header is a button that toggles the function /
// class body open; the code is fetched lazily on first expand (read_file_range)
// so a 20-symbol result list doesn't pull 20 file ranges up front.
function SymbolResult({ projectId, r }: { projectId: number; r: SymbolSearchResult }) {
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
      else setErr(res.error);
      setLoading(false);
    }
  };

  return (
    <div className="card sresult">
      <button
        type="button"
        className="sresult-head"
        onClick={() => void toggle()}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          font: "inherit",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {open ? (
          <ChevronDown size={14} color="var(--text-3)" />
        ) : (
          <ChevronRight size={14} color="var(--text-3)" />
        )}
        <Variable size={15} color="var(--text-2)" />
        <span className="sresult-path">
          <strong>{r.name}</strong>
          <span className="sym-kind">{r.kind}</span>
        </span>
        <span className="sresult-lines">
          {r.file_path} · L{r.start_line}–{r.end_line}
        </span>
      </button>
      {open ? (
        loading ? (
          <div className="scode" style={{ color: "var(--text-3)" }}>{t("common.loading")}</div>
        ) : err ? (
          <div className="scode" style={{ color: "var(--t-bug)" }}>{err}</div>
        ) : code != null ? (
          <CodeSnippet path={r.file_path} content={code} formatted={false} />
        ) : null
      ) : null}
    </div>
  );
}

function resultCount(r: Results): number {
  return r.items.length;
}

function hint(scope: SearchScope): string {
  if (scope === "symbol") return t("search.hintSymbol");
  if (scope === "text") return t("search.hintText");
  return t("search.hintSemantic");
}
