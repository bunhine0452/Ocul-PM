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
import { commands, type ChunkSearchResult } from "@/lib/bindings";
import { useWorkspace, type SearchScope } from "@/contexts/WorkspaceContext";

// Final UI Update (ui_v2) — 코드 검색 화면 (02-screen-specs §5). Real semantic
// search via the existing searchChunks command (Decision F). The backend only
// ships ONE search mode (semantic chunk search), so the mockup's 3 scope-chips
// render but symbol/text are disabled with a "1.1" hint — only "의미 검색" runs.
// scope persists in WorkspaceContext.searchScope.

const SEARCH_LIMIT = 20;

const SCOPES: { id: SearchScope; label: string; icon: React.ComponentType<{ size?: number }>; enabled: boolean }[] = [
  { id: "semantic", label: "의미 검색", icon: SparklesIcon, enabled: true },
  { id: "symbol", label: "심볼", icon: Variable, enabled: false },
  { id: "text", label: "정확히 일치", icon: CaseSensitive, enabled: false },
];

interface SearchScreenV2Props {
  projectId: number;
}

export function SearchScreenV2({ projectId }: SearchScreenV2Props) {
  const { state, setState } = useWorkspace();
  const scope = state.searchScope;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChunkSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const setScope = (next: SearchScope) =>
    setState((prev) => ({ ...prev, searchScope: next }));

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults(null);
        return;
      }
      setLoading(true);
      setError(null);
      const res = await commands.searchChunks(projectId, trimmed, SEARCH_LIMIT);
      if (res.status === "ok") {
        setResults(res.data);
      } else {
        setResults(null);
        setError(res.error);
      }
      setLoading(false);
    },
    [projectId],
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
    void runSearch(query);
  };

  const show = query.trim().length > 0 && results != null;

  return (
    <>
      <Toolbar title="시맨틱 코드 검색" sub="로컬 인덱스 · 의미 기반">
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
                placeholder="자연어로 검색 후 Enter… (⌘F 포커스, ⌘N 초기화)"
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
                    onClick={() => s.enabled && setScope(s.id)}
                    disabled={!s.enabled}
                    title={s.enabled ? undefined : "1.1 에서 지원 예정"}
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
            <div className="empty-hint">검색 중…</div>
          ) : show && results!.length === 0 ? (
            <div className="empty-hint">결과가 없어요. 다른 키워드로 시도해보세요.</div>
          ) : show ? (
            <div className="search-results">
              <div className="section-title" style={{ marginBottom: 12 }}>
                {results!.length}개 결과 · 의미 유사도순
              </div>
              {results!.map((r) => (
                <div className="card sresult" key={`${r.chunk_id}`}>
                  <div className="sresult-head">
                    <FileCode2 size={15} color="var(--text-2)" />
                    <span className="sresult-path">{r.file_path}</span>
                    <span className="sresult-lines">
                      L{r.start_line}–{r.end_line}
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
                  <div className="scode">{r.content}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-hint">
              검색어를 입력하면 의미 기반으로 관련 코드를 찾아줍니다.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
