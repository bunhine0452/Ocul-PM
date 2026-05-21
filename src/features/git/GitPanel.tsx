import { useCallback, useEffect, useMemo, useState } from "react";
import {
  commands,
  type GitCommit,
  type GitRepoStatus,
  type GitTag,
  type GithubRelease,
} from "@/lib/bindings";
import {
  GitBranch,
  RefreshCw,
  Copy,
  FileCode,
  Loader2,
} from "@/components/Icons";
import { Markdown } from "@/components/Markdown";

interface GitPanelProps {
  projectId: number;
}

// MASTER-GUIDE §5.6 — "changelog" 탭은 W4 에서 전용 Changelog 화면으로 승격됨.
// 이 GitPanel 은 git/GitHub 메타데이터만 다룬다.
type GitView = "commits" | "tags" | "releases";

const DEFAULT_LIMIT = 50;

function fmtTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const diff = Date.now() - date.getTime();
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

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString();
}

function authorInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

function colorFromString(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 35% 55%)`;
}

export function GitPanel({ projectId }: GitPanelProps) {
  const [status, setStatus] = useState<GitRepoStatus | null>(null);
  const [view, setView] = useState<GitView>("commits");

  const load = useCallback(async () => {
    const statusRes = await commands.gitStatus(projectId);
    if (statusRes.status === "ok") setStatus(statusRes.data);
    else setStatus({ is_git_repo: false, head_branch: null, remotes: [] });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const githubRemote = useMemo(
    () => status?.remotes.find((r) => r.host === "github.com" && r.owner && r.repo),
    [status]
  );

  const githubRepoUrl = useMemo(() => {
    if (!githubRemote || !githubRemote.owner || !githubRemote.repo) return null;
    return `https://github.com/${githubRemote.owner}/${githubRemote.repo}`;
  }, [githubRemote]);

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
      <div className="border-b border-border/60 px-5 py-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">
              {status.head_branch || "(detached HEAD)"}
            </span>
            {githubRemote && (
              <a
                href={githubRepoUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
                title={`${githubRemote.owner}/${githubRemote.repo}`}
              >
                GitHub
              </a>
            )}
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 -mb-3">
          {([
            { id: "commits", label: "Commits" },
            { id: "tags", label: "Tags" },
            { id: "releases", label: "Releases" },
          ] as Array<{ id: GitView; label: string }>).map((t) => {
            const active = view === t.id;
            const disabled = t.id === "releases" && !githubRemote;
            return (
              <button
                key={t.id}
                onClick={() => !disabled && setView(t.id)}
                disabled={disabled}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors cursor-pointer ${
                  active
                    ? "border-primary text-primary"
                    : disabled
                    ? "border-transparent text-muted-foreground/40 cursor-not-allowed"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                title={disabled ? "Needs a GitHub remote" : undefined}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {view === "commits" && (
          <CommitsView projectId={projectId} githubRepoUrl={githubRepoUrl} />
        )}
        {view === "tags" && (
          <TagsView projectId={projectId} githubRepoUrl={githubRepoUrl} />
        )}
        {view === "releases" && githubRemote && (
          <ReleasesView owner={githubRemote.owner!} repo={githubRemote.repo!} />
        )}
      </div>
    </div>
  );
}

// ---------- Views ----------

function CommitsView({
  projectId,
  githubRepoUrl,
}: {
  projectId: number;
  githubRepoUrl: string | null;
}) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await commands.gitLog(projectId, limit);
    if (res.status === "ok") setCommits(res.data);
    else setError(res.error);
    setLoading(false);
  }, [projectId, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end gap-2 px-5 py-2 border-b border-border/40">
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.currentTarget.value))}
          className="h-7 text-xs rounded-md border border-border bg-background px-2"
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
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-destructive bg-destructive/10 border-b border-destructive/20 px-5 py-2">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && commits.length === 0 ? (
          <Loading label="Loading commits…" />
        ) : commits.length === 0 ? (
          <Empty label="No commits yet." />
        ) : (
          <ul className="divide-y divide-border/60">
            {commits.map((c) => {
              const isOpen = selected === c.sha;
              const ghUrl = githubRepoUrl ? `${githubRepoUrl}/commit/${c.sha}` : null;
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
                      <div className="text-sm text-foreground truncate">{c.subject}</div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 font-mono">
                        <span className="truncate max-w-[140px]">{c.author_name}</span>
                        <span className="opacity-30">·</span>
                        <span title={fmtAbsolute(c.timestamp)}>{fmtTime(c.timestamp)}</span>
                        <span className="opacity-30">·</span>
                        <code className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded">
                          {c.short_sha}
                        </code>
                      </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3 ml-10 pl-3 border-l border-border/60 space-y-2 text-xs">
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        <Label>SHA</Label>
                        <code className="font-mono text-foreground break-all">{c.sha}</code>
                        <Label>Author</Label>
                        <span className="font-mono text-foreground">
                          {c.author_name} &lt;{c.author_email}&gt;
                        </span>
                        <Label>Date</Label>
                        <span className="font-mono text-foreground">
                          {fmtAbsolute(c.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <ActionButton
                          onClick={(e) => {
                            e.stopPropagation();
                            copy(c.sha, c.short_sha);
                          }}
                          icon={<Copy className="w-3 h-3" />}
                        >
                          {copied === c.short_sha ? "Copied" : "Copy SHA"}
                        </ActionButton>
                        {ghUrl && (
                          <a
                            href={ghUrl}
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

function TagsView({
  projectId,
  githubRepoUrl,
}: {
  projectId: number;
  githubRepoUrl: string | null;
}) {
  const [tags, setTags] = useState<GitTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [commitsByTag, setCommitsByTag] = useState<Record<string, GitCommit[]>>({});
  const [loadingTag, setLoadingTag] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await commands.gitTags(projectId, 100);
    if (res.status === "ok") setTags(res.data);
    else setError(res.error);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (tag: GitTag, prev: GitTag | undefined) => {
    const key = tag.name;
    if (expanded.has(key)) {
      const next = new Set(expanded);
      next.delete(key);
      setExpanded(next);
      return;
    }
    const next = new Set(expanded);
    next.add(key);
    setExpanded(next);

    if (!commitsByTag[key]) {
      setLoadingTag(key);
      const from = prev ? prev.name : "";
      const res = await commands.gitLogRange(projectId, from, tag.name, 200);
      if (res.status === "ok") {
        setCommitsByTag((m) => ({ ...m, [key]: res.data }));
      }
      setLoadingTag(null);
    }
  };

  if (loading) return <Loading label="Loading tags…" />;
  if (error) return <ErrorBox text={error} />;
  if (tags.length === 0)
    return <Empty label="No tags found in this repository." />;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <ul className="divide-y divide-border/60">
        {tags.map((t, idx) => {
          // The "previous" tag in chronological order — used for the commit
          // range. Tags are returned newest-first, so the previous version is
          // the *next* entry in the list.
          const previous = tags[idx + 1];
          const isOpen = expanded.has(t.name);
          const ghUrl = githubRepoUrl ? `${githubRepoUrl}/releases/tag/${t.name}` : null;
          const commits = commitsByTag[t.name];

          return (
            <li key={t.name}>
              <button
                onClick={() => toggle(t, previous)}
                className="w-full text-left px-5 py-3 hover:bg-accent/30 transition-colors cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-semibold text-foreground">
                        {t.name}
                      </span>
                      {t.timestamp > 0 && (
                        <span
                          className="text-[11px] text-muted-foreground"
                          title={fmtAbsolute(t.timestamp)}
                        >
                          {fmtTime(t.timestamp)}
                        </span>
                      )}
                    </div>
                    {t.subject && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {t.subject}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {ghUrl && (
                      <a
                        href={ghUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        GitHub
                      </a>
                    )}
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="px-5 pb-4">
                  {t.message && (
                    <div className="mb-3 p-3 rounded-md border border-border/60 bg-muted/30 text-xs whitespace-pre-wrap font-mono">
                      {t.message}
                    </div>
                  )}
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                    {previous
                      ? `Commits from ${previous.name} → ${t.name}`
                      : `Commits up to ${t.name}`}
                  </div>
                  {loadingTag === t.name ? (
                    <div className="text-xs text-muted-foreground py-2">Loading commits…</div>
                  ) : commits && commits.length > 0 ? (
                    <ul className="space-y-1 text-xs">
                      {commits.map((c) => (
                        <li key={c.sha} className="font-mono flex items-baseline gap-2">
                          <code className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded text-muted-foreground">
                            {c.short_sha}
                          </code>
                          <span className="text-foreground truncate">{c.subject}</span>
                          <span className="text-muted-foreground/60 text-[10px] flex-shrink-0">
                            {c.author_name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-muted-foreground italic">
                      No commits in this range.
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ChangelogView 는 W4 의 ChangelogScreen (전용 화면) 으로 승격되었음.
// 본 GitPanel 에서 CHANGELOG 파일 표시 기능은 제거.

function ReleasesView({ owner, repo }: { owner: string; repo: string }) {
  const [releases, setReleases] = useState<GithubRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await commands.githubReleases(owner, repo, 30);
    if (res.status === "ok") setReleases(res.data);
    else setError(res.error);
    setLoading(false);
  }, [owner, repo]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading label={`Fetching releases for ${owner}/${repo}…`} />;
  if (error) return <ErrorBox text={error} />;
  if (releases.length === 0)
    return <Empty label="No releases published on GitHub." />;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin divide-y divide-border/60">
      {releases.map((r) => (
        <div key={r.tag_name + r.html_url} className="px-5 py-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground">
                  {r.name || r.tag_name}
                </span>
                {r.prerelease && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider bg-amber-500/15 text-amber-700 border border-amber-500/30">
                    pre-release
                  </span>
                )}
                {r.draft && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider bg-muted text-muted-foreground border border-border">
                    draft
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1 font-mono">
                <code>{r.tag_name}</code>
                {r.published_at && (
                  <>
                    <span className="opacity-30">·</span>
                    <span>{fmtIso(r.published_at)}</span>
                  </>
                )}
                {r.author_login && (
                  <>
                    <span className="opacity-30">·</span>
                    <span>@{r.author_login}</span>
                  </>
                )}
              </div>
            </div>
            <a
              href={r.html_url}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] px-2 py-1 rounded border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <FileCode className="w-3 h-3" />
              GitHub
            </a>
          </div>
          {r.body && (
            <div className="prose prose-sm dark:prose-invert max-w-none mt-2">
              <Markdown>{r.body}</Markdown>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- Reusable bits ----------

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center p-8 text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin mr-2" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function Empty({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center gap-1">
      <div className="text-sm text-muted-foreground">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div className="m-5 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
      {text}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground/70 uppercase tracking-wider text-[10px]">
      {children}
    </span>
  );
}

function ActionButton({
  onClick,
  icon,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] px-2 py-1 rounded border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
    >
      {icon}
      {children}
    </button>
  );
}
