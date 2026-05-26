/**
 * OculpmSettings — per-project GUI for `OculpmConfig`. Mounted as the
 * `ocul-pm` tab in `SettingsPanel`.
 *
 * Five sections (00-spec.md §5):
 *   1. Workday  — timezone + day_starts_at
 *   2. Session  — inactivity_timeout + 3 toggles
 *   3. Git      — journal_committed + forbid + auto_redact patterns
 *   4. Watcher  — ignore + respect_gitignore + debounce_ms + batch_max
 *   5. Agents   — active chips + detect / sync buttons + 2 toggles
 *
 * Save flow (PR7 §3): every input updates local React state. A 500ms
 * debounce coalesces typing into one `oculpmApi.setConfig` call. Backend
 * validation failures surface as an inline error banner; the local state is
 * preserved so the user can keep editing.
 *
 * Regex / glob inline validation: bad entries don't block typing — they
 * render a red helper line next to the chip. The whole-config save still
 * goes through (backend won't crash on a malformed regex; it just skips
 * that pattern at compile time per `oculpm::redact::compile_redact_patterns`).
 *
 * Agents activate/deactivate kicks off a `syncAgents` call after the config
 * save so the corresponding adapter file is created / removed in one click.
 *
 * See `docs/major_update/oculpm/W4/PR7-oculpm-settings.md`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { commands, type AgentDetection, type OculpmConfig } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Plus,
} from "@/components/Icons";

const DEBOUNCE_MS = 500;

// W4 dogfooding finding (2026-05-25) — `agents-md` is the universal AGENTS.md
// surface; the per-tool entries below render as `@AGENTS.md` delegation stubs
// when their adapter file is also active.
const KNOWN_AGENTS = [
  { id: "agents-md", label: "AGENTS.md (권장)" },
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "antigravity", label: "Antigravity" },
  { id: "gemini-cli", label: "Gemini CLI" },
] as const;

export function OculpmSettings() {
  const { state } = useWorkspace();
  const projectId = state.currentProjectId;

  if (projectId == null) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        프로젝트를 먼저 선택하세요.
      </div>
    );
  }

  return <OculpmSettingsBody projectId={projectId} />;
}

function OculpmSettingsBody({ projectId }: { projectId: number }) {
  const [config, setConfig] = useState<OculpmConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [detections, setDetections] = useState<AgentDetection[] | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    null | { kind: "pending" } | { kind: "ok"; updated: number } | { kind: "error"; message: string }
  >(null);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    oculpmApi
      .getConfig(projectId)
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof OculpmApiError ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Debounced setConfig
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    if (!config) return;
    const serialised = JSON.stringify(config);
    if (lastSaved.current === serialised) return;
    const handle = window.setTimeout(() => {
      lastSaved.current = serialised;
      oculpmApi
        .setConfig(projectId, config)
        .then(() => {
          setSaveError(null);
          setSavedAt(Date.now());
        })
        .catch((e) => {
          setSaveError(e instanceof OculpmApiError ? e.message : String(e));
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [config, projectId]);

  const update = useCallback(
    (mut: (draft: OculpmConfig) => OculpmConfig) => {
      setConfig((prev) => (prev ? mut(structuredClone(prev)) : prev));
    },
    [],
  );

  const handleDetect = useCallback(async () => {
    try {
      const result = await oculpmApi.detectAgents(projectId);
      setDetections(result);
    } catch (e) {
      setDetections(null);
      setSaveError(e instanceof OculpmApiError ? e.message : String(e));
    }
  }, [projectId]);

  const handleSync = useCallback(async () => {
    setSyncStatus({ kind: "pending" });
    try {
      const report = await oculpmApi.syncAgents(projectId);
      const updated = report.results.filter(
        (r) => r.action === "inserted" || r.action === "updated",
      ).length;
      setSyncStatus({ kind: "ok", updated });
    } catch (e) {
      setSyncStatus({
        kind: "error",
        message: e instanceof OculpmApiError ? e.message : String(e),
      });
    }
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 설정 로딩…
      </div>
    );
  }
  if (loadError || !config) {
    return (
      <div className="rounded border border-red-700 bg-red-900/20 p-3 text-sm text-red-200">
        설정을 불러올 수 없습니다: {loadError ?? "unknown"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {saveError && (
        <div className="rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-300 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>저장 실패: {saveError}</span>
        </div>
      )}
      {savedAt && !saveError && (
        <div className="text-[11px] text-emerald-500">
          저장됨 ({new Date(savedAt).toLocaleTimeString()})
        </div>
      )}

      <Section title="Workday" description="작업일 경계와 timezone.">
        <Field label="Timezone (IANA)">
          <Input
            value={config.workday.timezone}
            onChange={(e) =>
              update((d) => ({
                ...d,
                workday: { ...d.workday, timezone: e.currentTarget.value },
              }))
            }
            placeholder="Asia/Seoul"
          />
        </Field>
        <Field label="Day starts at (HH:MM, 24h)">
          <Input
            value={config.workday.day_starts_at}
            onChange={(e) =>
              update((d) => ({
                ...d,
                workday: { ...d.workday, day_starts_at: e.currentTarget.value },
              }))
            }
            placeholder="00:00"
          />
          {!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.workday.day_starts_at) && (
            <p className="text-[10px] text-amber-400 mt-1">
              `HH:MM` 형식이어야 합니다 (예: 03:00).
            </p>
          )}
        </Field>
      </Section>

      <Section title="Session" description="세션 idle / 자동 종료 정책.">
        <Field
          label={`Inactivity timeout — ${config.session.inactivity_timeout_minutes}분`}
        >
          <input
            type="range"
            min={5}
            max={240}
            step={5}
            value={config.session.inactivity_timeout_minutes}
            onChange={(e) =>
              update((d) => ({
                ...d,
                session: {
                  ...d.session,
                  inactivity_timeout_minutes: Number(e.currentTarget.value),
                },
              }))
            }
            className="w-full"
          />
        </Field>
        <Toggle
          label="작업일 경계에서 자동 종료"
          checked={config.session.auto_close_on_workday_boundary}
          onChange={(v) =>
            update((d) => ({
              ...d,
              session: { ...d.session, auto_close_on_workday_boundary: v },
            }))
          }
        />
        <Toggle
          label="앱 종료 시 세션 자동 종료"
          checked={config.session.auto_close_on_app_quit}
          onChange={(v) =>
            update((d) => ({
              ...d,
              session: { ...d.session, auto_close_on_app_quit: v },
            }))
          }
        />
        <Field label={`Crash recovery grace — ${config.session.crash_recovery_grace_minutes}분`}>
          <input
            type="range"
            min={1}
            max={30}
            value={config.session.crash_recovery_grace_minutes}
            onChange={(e) =>
              update((d) => ({
                ...d,
                session: {
                  ...d.session,
                  crash_recovery_grace_minutes: Number(e.currentTarget.value),
                },
              }))
            }
            className="w-full"
          />
        </Field>
        <Field
          label={`Resume grace — ${config.session.session_resume_grace_minutes}분 ${
            config.session.session_resume_grace_minutes === 0 ? "(비활성)" : ""
          }`}
        >
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={config.session.session_resume_grace_minutes}
            onChange={(e) =>
              update((d) => ({
                ...d,
                session: {
                  ...d.session,
                  session_resume_grace_minutes: Number(e.currentTarget.value),
                },
              }))
            }
            className="w-full"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            inactivity 로 종료된 직후 이 시간 안에 새 file 변경이 들어오면, 새 세션을
            만들지 않고 직전 세션을 다시 엽니다 (W4 dogfooding fix). 0 으로 두면 비활성.
          </p>
        </Field>
      </Section>

      <Section title="Git" description="journal commit 여부 + 민감 경로 / 정규식.">
        <Toggle
          label="journal/ 를 git commit 으로 추적"
          checked={config.git.journal_committed}
          onChange={(v) =>
            update((d) => ({ ...d, git: { ...d.git, journal_committed: v } }))
          }
        />
        <PatternList
          label="forbid_journal_for_paths (glob)"
          hint="이 패턴과 매치되는 경로는 narrative 작성이 거부됩니다."
          values={config.git.forbid_journal_for_paths}
          validate={() => null /* glob 은 backend 가 best-effort 컴파일 */}
          onChange={(next) =>
            update((d) => ({ ...d, git: { ...d.git, forbid_journal_for_paths: next } }))
          }
        />
        <PatternList
          label="auto_redact_patterns (regex)"
          hint="매치된 부분을 `[REDACTED]` 로 치환합니다 (W4-PR3)."
          values={config.git.auto_redact_patterns}
          validate={(p) => {
            try {
              new RegExp(p);
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : String(e);
            }
          }}
          onChange={(next) =>
            update((d) => ({ ...d, git: { ...d.git, auto_redact_patterns: next } }))
          }
        />
      </Section>

      <Section title="Watcher" description="파일시스템 워처 동작.">
        <PatternList
          label="ignore (gitignore 문법)"
          values={config.watcher.ignore}
          validate={() => null}
          onChange={(next) =>
            update((d) => ({ ...d, watcher: { ...d.watcher, ignore: next } }))
          }
        />
        <Toggle
          label="프로젝트 .gitignore 존중"
          checked={config.watcher.respect_gitignore}
          onChange={(v) =>
            update((d) => ({ ...d, watcher: { ...d.watcher, respect_gitignore: v } }))
          }
        />
        <Field label={`Debounce — ${config.watcher.debounce_ms} ms`}>
          <input
            type="range"
            min={50}
            max={2000}
            step={50}
            value={config.watcher.debounce_ms}
            onChange={(e) =>
              update((d) => ({
                ...d,
                watcher: { ...d.watcher, debounce_ms: Number(e.currentTarget.value) },
              }))
            }
            className="w-full"
          />
        </Field>
      </Section>

      <Section
        title="Agents"
        description="활성 어댑터 + 자동 감지 / 동기화 정책."
      >
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase text-muted-foreground tracking-wider">
            Active adapters
          </Label>
          <div className="flex flex-wrap gap-2">
            {KNOWN_AGENTS.map((agent) => {
              const active = config.agents.active.includes(agent.id);
              const detection = detections?.find((d) => d.agent_id === agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      agents: {
                        ...d.agents,
                        active: active
                          ? d.agents.active.filter((a) => a !== agent.id)
                          : [...d.agents.active, agent.id],
                      },
                    }))
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-background hover:bg-muted/50"
                  }`}
                >
                  {active && <Check className="h-3 w-3" />}
                  {agent.label}
                  {detection && (
                    <span className="text-[9px] uppercase tracking-wider opacity-70">
                      {detection.confidence}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleDetect}>
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            감지
          </Button>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncStatus?.kind === "pending"}>
            {syncStatus?.kind === "pending" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            지금 동기화
          </Button>
          {syncStatus?.kind === "ok" && (
            <span className="text-[11px] text-emerald-400">
              완료 ({syncStatus.updated} 어댑터 갱신)
            </span>
          )}
          {syncStatus?.kind === "error" && (
            <span className="text-[11px] text-red-400">{syncStatus.message}</span>
          )}
        </div>
        <Toggle
          label="프로젝트 열 때 자동 감지"
          checked={config.agents.auto_detect_on_open}
          onChange={(v) =>
            update((d) => ({ ...d, agents: { ...d.agents, auto_detect_on_open: v } }))
          }
        />
        <Toggle
          label="config 저장 시 자동 동기화"
          checked={config.agents.auto_sync_adapters}
          onChange={(v) =>
            update((d) => ({ ...d, agents: { ...d.agents, auto_sync_adapters: v } }))
          }
        />
      </Section>

      <LogsSection />
    </div>
  );
}

// W4 dogfooding follow-up (2026-05-26) — Logs section. Shows the daily-rotated
// log dir path + a button to reveal it in Finder/Explorer. The user can then
// attach the latest `oculpm.log.YYYY-MM-DD` to a bug report. Uses the now-
// scope-permitted `opener:allow-reveal-item-in-dir` capability (발견 7).
function LogsSection() {
  const [logDir, setLogDir] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void commands.oculpmGetLogDir().then((res) => {
      if (cancelled) return;
      if (res.status === "ok") setLogDir(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reveal = useCallback(async () => {
    if (!logDir) return;
    setRevealing(true);
    try {
      await revealItemInDir(logDir);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await navigator.clipboard.writeText(logDir);
        toast.warning(
          `Finder 를 열 수 없어 경로를 클립보드에 복사했습니다.\n${msg}`,
          { title: "로그 폴더 열기 실패" },
        );
      } catch {
        toast.destructive(`로그 폴더 열기 실패: ${msg}`);
      }
    } finally {
      setRevealing(false);
    }
  }, [logDir]);

  return (
    <Section
      title="로그"
      description="흐름 단계별 [FLOW] 로그가 일별로 저장됩니다. 문제가 생겼을 때 가장 최근 파일을 첨부해주세요."
    >
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">
          위치:{" "}
          <span className="font-mono break-all text-foreground/80">
            {logDir ?? "(로그 파일 비활성)"}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={reveal}
          disabled={!logDir || revealing}
        >
          {revealing ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
          )}
          로그 폴더 열기
        </Button>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          파일명 형식:{" "}
          <code className="font-mono">oculpm.log.YYYY-MM-DD</code> — backend(rust)
          + frontend(console) 양쪽 로그가 한 파일에 모입니다. <code>[FLOW]</code>{" "}
          태그로 grep 하면 "프로젝트 로드 → 외부 LLM 작성 → UI 갱신" 흐름의 각 단계가 보입니다.
        </p>
      </div>
    </Section>
  );
}

// ─── shared bits ────────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase text-muted-foreground tracking-wider">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="h-3.5 w-3.5"
      />
      <span>{label}</span>
    </label>
  );
}

function PatternList({
  label,
  hint,
  values,
  validate,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  validate: (pattern: string) => string | null;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const errors = useMemo(() => values.map((v) => validate(v)), [values, validate]);

  return (
    <div className="space-y-2">
      <Label className="text-[11px] uppercase text-muted-foreground tracking-wider">
        {label}
      </Label>
      {hint && <p className="text-[10px] text-muted-foreground -mt-1">{hint}</p>}
      <ul className="space-y-1">
        {values.map((v, i) => (
          <li key={`${v}-${i}`} className="flex items-center gap-2">
            <Input
              value={v}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.currentTarget.value;
                onChange(next);
              }}
              className="font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              aria-label="삭제"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            {errors[i] && (
              <span className="text-[10px] text-red-400">{errors[i]}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim().length) {
              onChange([...values, draft.trim()]);
              setDraft("");
            }
          }}
          placeholder="패턴 추가 후 Enter"
          className="font-mono text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!draft.trim()) return;
            onChange([...values, draft.trim()]);
            setDraft("");
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
