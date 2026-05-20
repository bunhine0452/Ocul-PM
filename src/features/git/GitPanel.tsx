import { useCallback, useEffect, useMemo, useState } from "react";
import {
  commands,
  type GitCommit,
  type GitRepoStatus,
} from "@/lib/bindings";
import {
  GitBranch,
  RefreshCw,
  Copy,
  FileCode,
  Loader2,
} from "@/components/Icons";

interface GitPanelProps {
  projectId: number;
}

const DEFAULT_LIMIT = 50;

function fmtTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const now = Date.now();
  const diff = now - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return date.toLocaleDateString();
}

function fmtAbsolute(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function authorInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

function colorFromString(seed: string): string {
  // Stable hue from seed — keeps the same author's chip color consistent.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 35% 55%)`;
}

export function GitPanel({ projectId }: GitPanelProps) {
  const [status, setStatus] = useState<GitRepoStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const statusRes = await commands.gitStatus(projectId);
    if (statusRes.status === "error") {
      setError(statusRes.error);
      setStatus({ is_git_repo: false, head_branch: null, remotes: [] });
      setLoading(false);
      return;
    }
    setStatus(statusRes.data);
    if (!statusRes.data.is_git_repo) {
      setCommits([]);
      setLoading(false);
      return;
    }
    const logRes = await commands.gitLog(projectId, limit);
    if (logRes.status === "ok") {
      setCommits(logRes.data);
    } else {
      setError(logRes.error);
      setCommits([]);
    }
    setLoading(false);
  }, [projectId, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const githubRemote = useMemo(() => {
    return status?.remotes.find((r) => r.host === "github.com");
  }, [status]);

  const githubRepoUrl = useMemo(() => {
    if (!githubRemote || !githubRemote.owner || !githubRemote.repo) return null;
    return `https://github.com/${githubRemote.owner}/${githubRemote.repo}`;
  }, [githubRemote]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  };

  if (!status) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Reading git status…</span>
      </div>
    );
  }

  if (!status.is_git_repo) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
        <GitBranch className="w-10 h-10 text-muted-foreground/40" />
        <div className="text-sm text-muted-foreground">
          This project folder is not a git repository.
        </div>
        <button
          onClick={load}
          className="text-xs text-primary hover:underline cursor-pointer"
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/60 px-5 py-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">
              {status.head_branch || "(detached HEAD)"}
            </span>
            {githubRemote && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider bg-primary/10 text-primary border border-primary/30">
                GitHub
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.currentTarget.value))}
              className="h-7 text-xs rounded-md border border-border bg-background px-2"
              title="Number of commits to load"
            >
              {[20, 50, 100, 250].map((n) => (
                <option key={n} value={n}>
                  Last {n}
                </option>
              ))}
            </select>
            <button
              onClick={load}
              disabled={loading}
              className="h-7 px-2.5 rounded-md text-xs flex items-center gap-1.5 border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
              title="Reload git log"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Remotes */}
        {status.remotes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {status.remotes.map((r) => (
              <a
                key={`${r.name}|${r.url}`}
                href={r.host === "github.com" && r.owner && r.repo
                  ? `https://github.com/${r.owner}/${r.repo}`
                  : undefined}
                target={r.host === "github.com" ? "_blank" : undefined}
                rel="noreferrer"
                className={`group inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border border-border bg-background hover:bg-accent/40 transition-colors ${
                  r.host === "github.com" && r.owner && r.repo
                    ? "cursor-pointer hover:border-primary/45"
                    : "cursor-default"
                }`}
                onClick={(e) => {
                  if (!(r.host === "github.com" && r.owner && r.repo)) {
                    e.preventDefault();
                  }
                }}
              >
                <span className="font-mono text-muted-foreground">{r.name}</span>
                <span className="opacity-30">·</span>
                {r.owner && r.repo ? (
                  <span className="font-mono text-foreground">
                    {r.owner}/{r.repo}
                  </span>
                ) : (
                  <span className="font-mono text-muted-foreground truncate max-w-xs">
                    {r.url}
                  </span>
                )}
              </a>
            ))}
          </div>
        )}

        {error && (
          <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded px-2 py-1">
            {error}
          </div>
        )}
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && commits.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-sm">Loading commits…</span>
          </div>
        ) : commits.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            No commits yet.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {commits.map((c) => {
              const isOpen = selected === c.sha;
              const ghCommitUrl = githubRepoUrl
                ? `${githubRepoUrl}/commit/${c.sha}`
                : null;
              return (
                <li
                  key={c.sha}
                  className={`px-5 py-3 hover:bg-accent/30 transition-colors cursor-pointer ${
                    isOpen ? "bg-accent/40" : ""
                  }`}
                  onClick={() => setSelected(isOpen ? null : c.sha)}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 mt-0.5"
                      style={{ background: colorFromString(c.author_email || c.author_name) }}
                      title={`${c.author_name} <${c.author_email}>`}
                    >
                      {authorInitial(c.author_name)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground truncate">
                        {c.subject}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 font-mono">
                        <span className="truncate max-w-[140px]" title={c.author_name}>
                          {c.author_name}
                        </span>
                        <span className="opacity-30">·</span>
                        <span title={fmtAbsolute(c.timestamp)}>{fmtTime(c.timestamp)}</span>
                        <span className="opacity-30">·</span>
                        <code className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded">
                          {c.short_sha}
                        </code>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copy(c.sha, c.short_sha);
                        }}
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title={copied === c.short_sha ? "Copied!" : "Copy SHA"}
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3 ml-10 pl-3 border-l border-border/60 space-y-2 text-xs">
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
                        <span className="text-muted-foreground/70 uppercase tracking-wider text-[10px]">
                          SHA
                        </span>
                        <code className="font-mono text-foreground break-all">
                          {c.sha}
                        </code>

                        <span className="text-muted-foreground/70 uppercase tracking-wider text-[10px]">
                          Author
                        </span>
                        <span className="font-mono text-foreground">
                          {c.author_name} &lt;{c.author_email}&gt;
                        </span>

                        <span className="text-muted-foreground/70 uppercase tracking-wider text-[10px]">
                          Date
                        </span>
                        <span className="font-mono text-foreground">
                          {fmtAbsolute(c.timestamp)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copy(c.sha, c.short_sha);
                          }}
                          className="text-[11px] px-2 py-1 rounded border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" />
                          {copied === c.short_sha ? "Copied" : "Copy SHA"}
                        </button>
                        {ghCommitUrl && (
                          <a
                            href={ghCommitUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] px-2 py-1 rounded border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <FileCode className="w-3 h-3" />
                            View on GitHub
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
