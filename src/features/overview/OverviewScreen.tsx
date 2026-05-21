import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  RefreshCw,
  Sparkles,
  FileCode,
  Network,
  Database,
  Pencil,
  Save,
  X,
} from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import {
  commands,
  type ProjectOverview,
  type ProjectStats,
} from "@/lib/bindings";

// MASTER-GUIDE §5.2 — Overview 화면. 인덱싱 후 자동 생성된 자연어 요약을
// 보여주고, 사용자가 "다시 생성" 으로 강제 재생성할 수 있다.

interface OverviewScreenProps {
  activeProjectId: number | null;
}

interface Stack {
  framework?: string;
  languages?: string[];
  package_manager?: string;
  ui?: string;
  data?: string;
  notes?: string;
}

export function OverviewScreen({ activeProjectId }: OverviewScreenProps) {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline-editing state for overview_md (MASTER-GUIDE §5.2 디렉터리 가이드
  // inline 편집). Identity/stack remain LLM-managed for now.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // We resolve the LLM provider/model from settings the same way the rest of
  // the app does (assist/chat panels). Keeping the choice in settings means
  // generation is a one-click action here.
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (activeProjectId == null) return;
    setLoading(true);
    setError(null);
    try {
      const [ov, st] = await Promise.all([
        commands.getProjectOverview(activeProjectId),
        commands.projectStats(activeProjectId),
      ]);
      if (ov.status === "ok") setOverview(ov.data);
      if (st.status === "ok") setStats(st.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Read defaults once on mount; the Overview screen does not let users
  // override provider/model — that's settings territory.
  useEffect(() => {
    (async () => {
      const p = await commands.settingsGet("default_provider");
      if (p.status === "ok" && p.data) setProvider(p.data);
      const m = await commands.settingsGet("default_model");
      if (m.status === "ok" && m.data) setModel(m.data);
    })();
  }, []);

  function startEdit() {
    if (!overview) return;
    setDraft(overview.overview_md ?? "");
    setEditing(true);
  }

  async function saveEdit() {
    if (activeProjectId == null) return;
    setSaving(true);
    setError(null);
    const res = await commands.updateProjectOverview(
      activeProjectId,
      overview?.identity ?? null,
      overview?.stack_json ?? null,
      draft,
    );
    if (res.status === "ok") {
      setOverview(res.data);
      setEditing(false);
    } else {
      setError((res as any).error ?? "저장 실패");
    }
    setSaving(false);
  }

  async function regenerate() {
    if (activeProjectId == null) return;
    if (!provider || !model) {
      setError("기본 LLM provider / model 이 설정되지 않았습니다. Settings 에서 지정해 주세요.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await commands.generateProjectOverview(
        activeProjectId,
        provider,
        model,
      );
      if (res.status === "ok") {
        setOverview(res.data);
      } else {
        setError((res as any).error ?? "생성 실패");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  const stack = useMemo<Stack | null>(() => {
    if (!overview?.stack_json) return null;
    try {
      return JSON.parse(overview.stack_json) as Stack;
    } catch {
      return null;
    }
  }, [overview?.stack_json]);

  if (activeProjectId == null) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        프로젝트를 먼저 선택해주세요.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">Overview</h1>
            <p className="text-xs text-muted-foreground mt-1">
              이 코드베이스가 어떤 앱인지 살펴보세요
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading || generating}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              새로 고침
            </Button>
            <Button
              size="sm"
              onClick={regenerate}
              disabled={generating || loading}
            >
              {generating ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              )}
              개요 다시 생성
            </Button>
          </div>
        </header>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
            {error}
          </div>
        )}

        {loading && !overview ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
          </div>
        ) : !overview ? (
          <EmptyState onGenerate={regenerate} disabled={generating || !provider || !model} />
        ) : (
          <>
            <IdentityCard identity={overview.identity} />
            {stack && <StackCard stack={stack} />}
            <StatsRow stats={stats} overview={overview} />
            <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  본문 (디렉터리 가이드 · 진입점 등)
                </h3>
                {editing ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      onClick={saveEdit}
                      disabled={saving || draft.trim().length === 0}
                    >
                      {saving ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      저장
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                      <X className="w-3.5 h-3.5 mr-1.5" />
                      취소
                    </Button>
                  </div>
                ) : (
                  overview.overview_md && (
                    <Button size="sm" variant="outline" onClick={startEdit}>
                      <Pencil className="w-3.5 h-3.5 mr-1.5" />
                      편집
                    </Button>
                  )
                )}
              </div>

              {editing ? (
                <>
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="마크다운으로 자유롭게 작성하세요. ## 정체성 / ## 디렉터리 가이드 / ## 진입점 …"
                    className="min-h-[320px] font-mono text-xs leading-relaxed"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    저장 시 자동 재생성으로부터 보호됩니다 — "개요 다시 생성" 을 명시적으로
                    눌러야만 LLM 이 다시 작성합니다.
                  </p>
                </>
              ) : overview.overview_md ? (
                <Markdown>{overview.overview_md}</Markdown>
              ) : (
                <p className="text-xs text-muted-foreground">본문이 비어있습니다.</p>
              )}
            </section>
            {overview.generated_at && (
              <footer className="text-[11px] text-muted-foreground text-right">
                마지막 {overview.source_signature === null ? "수정" : "생성"}:{" "}
                {new Date(overview.generated_at * 1000).toLocaleString("ko-KR")}
                {overview.generated_by_model && ` · ${overview.generated_by_model}`}
              </footer>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  onGenerate,
  disabled,
}: {
  onGenerate: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center space-y-3">
      <Sparkles className="w-8 h-8 mx-auto text-muted-foreground" />
      <p className="text-sm">
        아직 개요가 만들어지지 않았습니다. 인덱싱을 마친 뒤 자동 생성되거나,
        지금 바로 생성할 수 있습니다.
      </p>
      <Button onClick={onGenerate} disabled={disabled}>
        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
        지금 생성하기
      </Button>
      {disabled && (
        <p className="text-[11px] text-muted-foreground">
          Settings 에서 기본 provider / model 을 먼저 지정해주세요.
        </p>
      )}
    </div>
  );
}

function IdentityCard({ identity }: { identity: string | null }) {
  if (!identity) return null;
  return (
    <section className="rounded-2xl border border-border bg-secondary/40 p-5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
        정체성
      </div>
      <p className="text-base font-medium leading-relaxed">{identity}</p>
    </section>
  );
}

function StackCard({ stack }: { stack: Stack }) {
  const chips: string[] = [];
  if (stack.framework) chips.push(stack.framework);
  (stack.languages ?? []).forEach((l) => chips.push(l));
  if (stack.ui) chips.push(stack.ui);
  if (stack.data) chips.push(stack.data);
  if (stack.package_manager) chips.push(stack.package_manager);

  if (chips.length === 0 && !stack.notes) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        스택
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span
            key={c}
            className="text-xs px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground border border-border"
          >
            {c}
          </span>
        ))}
      </div>
      {stack.notes && (
        <p className="text-xs text-muted-foreground mt-3">{stack.notes}</p>
      )}
    </section>
  );
}

function StatsRow({
  stats,
  overview,
}: {
  stats: ProjectStats | null;
  overview: ProjectOverview;
}) {
  const items = [
    { icon: FileCode, label: "파일", value: stats?.files ?? "—" },
    { icon: Database, label: "청크", value: stats?.chunks ?? "—" },
    {
      icon: Network,
      label: "스택 키",
      value: overview.stack_json
        ? Object.keys(safeParse(overview.stack_json)).length
        : "—",
    },
  ];
  return (
    <section className="grid grid-cols-3 gap-3">
      {items.map(({ icon: Icon, label, value }) => (
        <div
          key={label}
          className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3"
        >
          <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="text-sm font-semibold truncate">{value}</div>
          </div>
        </div>
      ))}
    </section>
  );
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
