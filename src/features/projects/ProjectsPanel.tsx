import { useEffect, useState } from "react";
import { DependencyGraphView } from "./DependencyGraphView";
import { Channel } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  commands,
  type ChunkSearchResult,
  type IndexProgress,
  type Project,
  type ProjectStats,
} from "@/lib/bindings";
import { Folder, FolderOpen, RefreshCw, Play, Trash2, Search } from "lucide-react";

type StatsMap = Record<number, ProjectStats>;

export function ProjectsPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<StatsMap>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [indexingId, setIndexingId] = useState<number | null>(null);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChunkSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<"search" | "dependencies">("search");

  async function refresh() {
    const res = await commands.listProjects();
    if (res.status === "ok") {
      setProjects(res.data);
      const all: StatsMap = {};
      for (const p of res.data) {
        const s = await commands.projectStats(p.id);
        if (s.status === "ok") all[p.id] = s.data;
      }
      setStats(all);
    } else {
      setError(res.error);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function addProject() {
    const folder = await commands.selectProjectFolder();
    if (folder.status !== "ok" || !folder.data) return;
    const path = folder.data;
    const name = path.split("/").filter(Boolean).pop() ?? "project";
    const created = await commands.createProject(name, path);
    if (created.status === "ok") {
      await refresh();
    } else {
      setError(created.error);
    }
  }

  async function startIndex(id: number, reset = false) {
    setIndexingId(id);
    setProgress(null);
    setError(null);

    if (reset) {
      const cleared = await commands.clearProjectIndex(id);
      if (cleared.status === "error") {
        setError(cleared.error);
        setIndexingId(null);
        return;
      }
    }

    const channel = new Channel<IndexProgress>();
    channel.onmessage = (p) => setProgress(p);

    const res = await commands.indexProject(id, channel);
    if (res.status === "error") {
      setError(res.error);
    }
    setIndexingId(null);
    setProgress(null);
    await refresh();
  }

  async function runSearch() {
    if (selectedId == null || !query.trim()) return;
    setSearching(true);
    setResults(null);
    setError(null);
    const res = await commands.searchChunks(selectedId, query, 8);
    if (res.status === "ok") {
      setResults(res.data);
    } else {
      setError(res.error);
    }
    setSearching(false);
  }

  return (
    <section className={`w-full transition-all duration-300 rounded-xl border bg-card p-6 space-y-6 shadow-sm ${
      selectedId != null && activeTab === "dependencies" ? "max-w-5xl" : "max-w-3xl"
    }`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-heading font-semibold text-foreground">Projects</h2>
        <Button onClick={addProject} disabled={indexingId != null} className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md">
          + Add Project
        </Button>
      </div>

      {projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-border rounded-xl bg-background/50">
          <Folder className="w-12 h-12 text-muted-foreground mb-4 opacity-50" strokeWidth={1} />
          <p className="text-sm text-muted-foreground">
            No projects yet. Add a folder to start indexing.
          </p>
        </div>
      )}

      {projects.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {projects.map((p) => {
            const s = stats[p.id];
            const isSelected = selectedId === p.id;
            const isIndexing = indexingId === p.id;
            return (
              <div
                key={p.id}
                onClick={() => {
                  if (isSelected) {
                    setSelectedId(null);
                  } else {
                    setSelectedId(p.id);
                    setActiveTab("search");
                  }
                }}
                className={`group relative flex flex-col items-center justify-start p-4 rounded-xl cursor-pointer transition-all border ${
                  isSelected 
                    ? "bg-primary/10 border-primary/30 shadow-inner" 
                    : "bg-background border-transparent hover:bg-muted hover:border-border"
                }`}
              >
                <div className="relative mb-3">
                  {isSelected ? (
                    <FolderOpen className="w-14 h-14 text-primary" strokeWidth={1} fill="currentColor" fillOpacity={0.2} />
                  ) : (
                    <Folder className="w-14 h-14 text-muted-foreground group-hover:text-foreground transition-colors" strokeWidth={1} fill="currentColor" fillOpacity={0.05} />
                  )}
                  {isIndexing && (
                    <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 shadow-sm border border-border">
                      <RefreshCw className="w-4 h-4 text-primary animate-spin" />
                    </div>
                  )}
                </div>
                <div className="text-center w-full">
                  <div className={`font-medium text-sm truncate ${isSelected ? "text-primary" : "text-foreground"}`}>
                    {p.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-1">
                    {s ? `${s.files} files` : "—"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Project Details Pane */}
      {selectedId != null && (
        <div className="rounded-xl border bg-background p-4 space-y-4 shadow-sm animate-in fade-in slide-in-from-top-2">
          {projects.filter(p => p.id === selectedId).map(p => {
            const s = stats[p.id];
            const isIndexing = indexingId === p.id;
            return (
              <div key={p.id} className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{p.name}</h3>
                    <p className="text-xs text-muted-foreground font-mono mt-1">{p.root_path}</p>
                    <p className="text-sm mt-2 text-muted-foreground">
                      {s ? `${s.files} files indexed, ${s.chunks} chunks stored.` : "Not indexed yet."}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startIndex(p.id)}
                      disabled={indexingId != null}
                      className="gap-2"
                    >
                      {isIndexing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      {isIndexing ? "Indexing…" : "Index"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startIndex(p.id, true)}
                      disabled={indexingId != null || !s || s.chunks === 0}
                      title="Clear all chunks and re-index from scratch"
                      className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3 h-3" />
                      Reindex
                    </Button>
                  </div>
                </div>

                {isIndexing && progress && (
                  <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground font-mono">
                      <span className="truncate max-w-[80%]">{progress.current_file}</span>
                      <span>{progress.current} / {progress.total}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300 ease-out"
                        style={{
                          width: `${(progress.current / Math.max(progress.total, 1)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                
                <div className="border-t pt-4 mt-4 space-y-4">
                  {/* Tab Navigation */}
                  <div className="flex border-b border-border/40 gap-4">
                    <button
                      onClick={() => setActiveTab("search")}
                      className={`pb-2 text-xs font-semibold uppercase tracking-wider transition-all border-b-2 ${
                        activeTab === "search"
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Code Search
                    </button>
                    <button
                      onClick={() => setActiveTab("dependencies")}
                      className={`pb-2 text-xs font-semibold uppercase tracking-wider transition-all border-b-2 ${
                        activeTab === "dependencies"
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Dependency Map
                    </button>
                  </div>

                  {activeTab === "search" ? (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={query}
                            onChange={(e) => setQuery(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") runSearch();
                            }}
                            placeholder="Search for functions, features..."
                            disabled={searching}
                            className="pl-9 bg-background focus-visible:ring-primary"
                          />
                        </div>
                        <Button onClick={runSearch} disabled={searching || !query.trim()} className="bg-primary text-primary-foreground">
                          {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Search"}
                        </Button>
                      </div>

                      {results && results.length === 0 && (
                        <div className="p-4 text-center text-sm text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
                          No matches found.
                        </div>
                      )}

                      {results && results.length > 0 && (
                        <ul className="space-y-3 max-h-96 overflow-y-auto pr-2">
                          {results.map((r) => (
                            <li
                              key={r.chunk_id}
                              className="rounded-lg border bg-surface-card p-3 space-y-2 shadow-sm"
                            >
                              <div className="flex items-baseline justify-between text-[11px] font-mono border-b pb-2">
                                <span className="truncate text-foreground font-medium">
                                  {r.file_path}:{r.start_line}-{r.end_line}
                                </span>
                                <span className="text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                  score: {r.distance?.toFixed(3) ?? "—"}
                                </span>
                              </div>
                              <pre className="text-xs leading-relaxed whitespace-pre-wrap break-all max-h-40 overflow-hidden text-muted-foreground font-mono">
                                {r.content}
                              </pre>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <DependencyGraphView projectId={p.id} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive whitespace-pre-wrap font-mono">
          {error}
        </p>
      )}
    </section>
  );
}
