import { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  SearchIcon,
  SparklesIcon,
  Variable,
  CaseSensitive,
  Database,
  FileCode2,
  X,
  TriangleAlert,
} from "@/components/Icons";
import { commands, type ChunkSearchResult, type SymbolSearchResult } from "@/lib/bindings";
import { useWorkspace, type SearchScope } from "@/contexts/WorkspaceContext";
import { OculSpinner } from "@/components/OculSpinner";
import { CodeSnippet } from "./CodeSnippet";

// Final UI Update (ui_v2) — 코드 검색 화면 (02-screen-specs §5). PR-R1b (A2):
// all three scopes are live — 의미(searchChunks, 임베딩) / 심볼(searchSymbols,
// AST 인덱스) / 정확(searchText, chunk content LIKE). Each persists in
// WorkspaceContext.searchScope. (Was: only 의미; symbol/text disabled "1.1".)

const SEARCH_LIMIT = 20;

const SCOPES: {
  id: SearchScope;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  placeholder: string;
}[] = [
  { id: "semantic", label: "의미 검색", icon: SparklesIcon, placeholder: "자연어로 검색 후 Enter…" },
  { id: "symbol", label: "심볼", icon: Variable, placeholder: "함수·클래스 등 심볼 이름…" },
  { id: "text", label: "정확히 일치", icon: CaseSensitive, placeholder: "정확히 일치할 문자열…" },
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
  const { state, setState } = useWorkspace();
  const scope = state.searchScope;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Feature 1 — pretty-print result code (Prettier / wasm-fmt). Defaults on;
  // "원본" shows the indexed text verbatim for snippets that don't format well.
  const [formatted, setFormatted] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(
    async (q: string, scopeArg: SearchScope) => {
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
            : await commands.searchChunks(projectId, trimmed, SEARCH_LIMIT);
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
    if (query.trim()) void runSearch(query, next);
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
    void runSearch(query, scope);
  };

  const show = query.trim().length > 0 && results != null;
  const activeScope = SCOPES.find((s) => s.id === scope) ?? SCOPES[0];

  return (
    <>
      <Toolbar title="코드 검색" sub="로컬 인덱스">
        <span className="chip">
          <Database size={13} /> 로컬 인덱스
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
                placeholder={`${activeScope.placeholder} (⌘F 포커스, ⌘N 초기화)`}
                aria-label="코드 검색"
              />
              {query ? (
                <button
                  type="button"
                  className="iconbtn"
                  onClick={() => {
                    setQuery("");
                    setResults(null);
                  }}
                  aria-label="검색어 지우기"
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
                    <Icon size={13} /> {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {error ? (
            <div className="card card-pad" style={{ maxWidth: 880, margin: "0 auto" }}>
              <div className="stat-top" style={{ color: "var(--t-bug)" }}>
                <TriangleAlert size={14} /> 검색에 실패했어요
              </div>
              <div className="today-date" style={{ marginTop: 8 }}>{error}</div>
            </div>
          ) : loading ? (
            <OculSpinner label="검색 중…" />
          ) : show && resultCount(results!) === 0 ? (
            <div className="empty-hint">결과가 없어요. 다른 키워드로 시도해보세요.</div>
          ) : show && results!.kind === "symbol" ? (
            <div className="search-results">
              <div className="section-title" style={{ marginBottom: 12 }}>
                {results!.items.length}개 심볼
              </div>
              {results!.items.map((r, i) => (
                <div className="card sresult" key={`${r.file_path}:${r.start_line}:${r.name}:${i}`}>
                  <div className="sresult-head">
                    <Variable size={15} color="var(--text-2)" />
                    <span className="sresult-path">
                      <strong>{r.name}</strong>
                      <span className="sym-kind">{r.kind}</span>
                    </span>
                    <span className="sresult-lines">
                      {r.file_path} · L{r.start_line}–{r.end_line}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : show ? (
            <div className="search-results">
              <div
                className="section-title"
                style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}
              >
                <span>
                  {results!.items.length}개 결과
                  {results!.kind === "chunk" && results!.mode === "semantic"
                    ? " · 의미 유사도순"
                    : " · 정확히 일치"}
                </span>
                <span style={{ flex: 1 }} />
                <div className="diff-mode-toggle" role="group" aria-label="코드 표시 방식">
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
                      {on ? "정렬" : "원본"}
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

function resultCount(r: Results): number {
  return r.items.length;
}

function hint(scope: SearchScope): string {
  if (scope === "symbol") return "함수·클래스·타입 등 심볼 이름으로 정의 위치를 찾습니다.";
  if (scope === "text") return "정확히 일치하는 문자열을 인덱스에서 찾습니다.";
  return "검색어를 입력하면 의미 기반으로 관련 코드를 찾아줍니다.";
}
