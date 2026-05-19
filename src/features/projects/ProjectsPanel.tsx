import { useEffect, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  commands,
  type ChunkSearchResult,
  type IndexProgress,
  type Project,
  type ProjectStats,
} from "@/lib/bindings";

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
    <section className="w-full max-w-md rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Projects</h2>
        <Button size="sm" onClick={addProject} disabled={indexingId != null}>
          + Add Project
        </Button>
      </div>

      {projects.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No projects yet. Add a folder to start indexing.
        </p>
      )}

      <ul className="space-y-2">
        {projects.map((p) => {
          const s = stats[p.id];
          const isSelected = selectedId === p.id;
          const isIndexing = indexingId === p.id;
          return (
            <li
              key={p.id}
              className={`rounded-md border p-3 space-y-2 ${
                isSelected ? "border-foreground/40 bg-muted/50" : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  {s ? `${s.files} files · ${s.chunks} chunks` : "—"}
                </div>
              </div>
              <div className="text-xs text-muted-foreground font-mono truncate">
                {p.root_path}
              </div>

              {isIndexing && progress && (
                <div className="text-xs space-y-1">
                  <div className="text-muted-foreground font-mono truncate">
                    {progress.current}/{progress.total} · {progress.current_file}
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-foreground transition-all"
                      style={{
                        width: `${(progress.current / Math.max(progress.total, 1)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => startIndex(p.id)}
                  disabled={indexingId != null}
                >
                  {isIndexing ? "Indexing…" : "Index"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => startIndex(p.id, true)}
                  disabled={indexingId != null || !s || s.chunks === 0}
                  title="Clear all chunks and re-index from scratch"
                >
                  Reindex
                </Button>
                <Button
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setSelectedId(isSelected ? null : p.id)}
                  disabled={indexingId != null}
                >
                  {isSelected ? "✓" : "Select"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {selectedId != null && (
        <div className="space-y-2 border-t pt-4">
          <Label className="text-xs uppercase text-muted-foreground tracking-wider">
            Code Search
          </Label>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="자연어로 코드 검색..."
              disabled={searching}
            />
            <Button onClick={runSearch} disabled={searching || !query.trim()}>
              {searching ? "…" : "Go"}
            </Button>
          </div>

          {results && results.length === 0 && (
            <p className="text-xs text-muted-foreground">No matches.</p>
          )}

          {results && results.length > 0 && (
            <ul className="space-y-2 max-h-80 overflow-y-auto">
              {results.map((r) => (
                <li
                  key={r.chunk_id}
                  className="rounded border bg-muted/30 p-2 space-y-1"
                >
                  <div className="flex items-baseline justify-between text-[10px] font-mono">
                    <span className="truncate text-muted-foreground">
                      {r.file_path}:{r.start_line}-{r.end_line}
                    </span>
                    <span className="text-muted-foreground">
                      d={r.distance?.toFixed(3) ?? "—"}
                    </span>
                  </div>
                  <pre className="text-[11px] leading-snug whitespace-pre-wrap break-all max-h-32 overflow-hidden">
                    {r.content}
                  </pre>
                </li>
              ))}
            </ul>
          )}
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
