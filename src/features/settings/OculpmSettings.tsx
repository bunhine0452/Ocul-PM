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
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import {
  commands,
  type AcpDiagnostics,
  type AgentDetection,
  type ClaudeHooksStatus,
  type ClaudePluginStatus,
  type DesktopRegistrationStatus,
  type McpRegistrationStatus,
  type OculpmConfig,
  type ShellIntegrationStatus,
} from "@/lib/bindings";
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
  ScanSearch,
  Trash2,
  Plus,
} from "@/components/Icons";
import { useT, type I18nKey } from "@/i18n";
import { tError } from "@/i18n/errors";
import { PluginBundlesBlock } from "./plugins/PluginBundlesBlock";

const DEBOUNCE_MS = 500;

// W4 dogfooding finding (2026-05-25) — `agents-md` is the universal AGENTS.md
// surface; the per-tool entries below render as `@AGENTS.md` delegation stubs
// when their adapter file is also active.
const KNOWN_AGENTS = [
  { id: "agents-md", label: "AGENTS.md", labelKey: "op.agentsMd" as I18nKey },
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "antigravity", label: "Antigravity" },
  { id: "gemini-cli", label: "Gemini CLI" },
  // v2 U4 (A1) — 어댑터 확대. Codex CLI 는 AGENTS.md 를 그대로 읽으므로 별도
  // 항목이 없다.
  { id: "windsurf", label: "Windsurf" },
  { id: "copilot", label: "GitHub Copilot" },
  { id: "aider", label: "aider" },
  { id: "cline", label: "Cline" },
  { id: "zed", label: "Zed" },
] as const;

export function OculpmSettings() {
  const { t } = useT();
  // 시작 탭(런처)에는 `WorkspaceProvider` 가 없다 — 설정 오버레이는 두 탭에서
  // **같은** 패널을 띄우므로 `useWorkspace()` 를 쓰면 시작 탭에서 예외가 나고,
  // 경계가 없어 React 가 창 트리를 통째로 언마운트해 창 전체가 빈 화면이 됐다.
  // 프로젝트가 없으면 조용히 빈 상태만 보여준다 (SettingsPanel 의 색인 탭과
  // 같은 접근자 — WorkspaceContext `useOptionalWorkspace` 주석 I2).
  const projectId = useOptionalWorkspace()?.state.currentProjectId ?? null;

  if (projectId == null) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        {t("op.pickProject")}
      </div>
    );
  }

  return <OculpmSettingsBody projectId={projectId} />;
}

/**
 * 하위 탭 (2026-07-20) — PR-CI0~CI8 이 이 화면에 훅·MCP·자동화 블록을 계속
 * 얹어 한 화면 스크롤이 과하게 길어졌다. 성격별로 4분할한다:
 * 기록(언제·무엇을 기록) / 에이전트(누가 규칙을 받나) / 자동화(과금 AI) /
 * 연동(Claude 훅·MCP) / 로그. 탭 상태는 이 화면 안의 일시적 UI 상태라
 * localStorage 가 아니라 useState (WorkspaceContext 규율 대상 아님).
 */
const SUB_TABS = [
  { id: "record", labelKey: "op.tab.record" },
  { id: "agents", labelKey: "op.tab.agents" },
  { id: "automation", labelKey: "op.tab.automation" },
  { id: "integration", labelKey: "op.tab.integration" },
  { id: "logs", labelKey: "op.tab.logs" },
] as const;

type SubTabId = (typeof SUB_TABS)[number]["id"];

export function SubTabs({
  value,
  onChange,
}: {
  value: SubTabId;
  onChange: (v: SubTabId) => void;
}) {
  const { t } = useT();
  return (
    <div className="seg flex-wrap" role="tablist" aria-label={t("op.tabsAria")}>
      {SUB_TABS.map((sub) => {
        const on = value === sub.id;
        return (
          <button
            key={sub.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(sub.id)}
            className="seg-item"
          >
            {t(sub.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function OculpmSettingsBody({ projectId }: { projectId: number }) {
  const { t } = useT();
  // 연동 탭의 "이 프로젝트" 머리말에만 쓴다 — 스코프를 추상적으로 말하지 않고
  // 지금 어느 프로젝트에 적용되는지 이름으로 못박기 위한 것. 없으면 이름 없는
  // 문구로 폴백한다 (런처에는 프로바이더가 없다 — `useOptionalWorkspace`).
  const projectName = useOptionalWorkspace()?.state.currentProjectName ?? null;
  // 플러그인 설치 여부는 "이 머신" 섹션의 배지이면서 동시에 "이 프로젝트"
  // 섹션의 경고 조건이다 — 두 섹션이 같은 사실을 봐야 하므로 블록마다 읽지
  // 않고 여기서 한 번 읽어 내려보낸다.
  const [plugin, setPlugin] = useState<ClaudePluginStatus | null>(null);
  const [sub, setSub] = useState<SubTabId>("record");
  const [config, setConfig] = useState<OculpmConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [detections, setDetections] = useState<AgentDetection[] | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    null | { kind: "pending" } | { kind: "ok"; updated: number } | { kind: "error"; message: string }
  >(null);

  useEffect(() => {
    let cancelled = false;
    void commands.claudePluginStatus().then((p) => {
      if (!cancelled) setPlugin(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        <Loader2 className="h-4 w-4 animate-spin" /> {t("op.loading")}
      </div>
    );
  }
  if (loadError || !config) {
    return (
      <div className="rounded border border-(--danger)/40 bg-(--danger-soft) p-3 text-sm text-(--danger-text)">
        {t("op.loadFailed", { error: loadError ?? "unknown" })}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {saveError && (
        <div className="rounded border border-(--danger)/40 bg-(--danger-soft) p-2 text-xs text-(--danger-text) flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{t("op.saveFailed", { error: saveError })}</span>
        </div>
      )}
      {savedAt && !saveError && (
        <div className="text-[11px] text-(--ok-text)">
          {t("op.saved", { time: new Date(savedAt).toLocaleTimeString() })}
        </div>
      )}

      <SubTabs value={sub} onChange={setSub} />

      {sub === "record" && (
      <>
      <Section title="Workday" description={t("op.workday.desc")}>
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
            <p className="text-[10px] text-(--warn-text) mt-1">
              {t("op.hhmm")}
            </p>
          )}
        </Field>
      </Section>

      <Section title="Session" description={t("op.session.desc")}>
        <Field
          label={t("op.session.inactivity", { n: config.session.inactivity_timeout_minutes })}
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
        {/* 「작업일 경계에서 자동 종료」·「앱 종료 시 자동 종료」·crash grace 는
            뺐다 — 아무 코드도 읽지 않는 키였고(둘 다 무조건 동작), 끄면 안 닫힐
            것처럼 보이는 거짓 스위치였다 (2026-08-30 감사). */}
        <Field
          label={t("op.session.resumeGrace", {
            n: config.session.session_resume_grace_minutes ?? 0,
            suffix: (config.session.session_resume_grace_minutes ?? 0) === 0 ? t("op.session.disabled") : "",
          })}
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
            {t("op.session.resumeHint")}
          </p>
        </Field>
      </Section>

      {/* `git.journal_committed` 토글은 뺐다 — 켜도 아무 동작이 없는 죽은 플래그
          (git commit 호출 0, 2026-08-30 감사). 설정 파일 키는 스키마 호환을 위해
          남아 있지만 화면에 보여 주면 "추적되고 있다" 는 거짓 믿음을 준다. */}
      <Section title="Git" description={t("op.git.desc")}>
        <PatternList
          label="forbid_journal_for_paths (glob)"
          hint={t("op.git.forbiddenHint")}
          values={config.git.forbid_journal_for_paths}
          validate={() => null /* glob 은 backend 가 best-effort 컴파일 */}
          onChange={(next) =>
            update((d) => ({ ...d, git: { ...d.git, forbid_journal_for_paths: next } }))
          }
        />
        <PatternList
          label="auto_redact_patterns (regex)"
          hint={t("op.git.redactHint")}
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

      <Section title="Watcher" description={t("op.watcher.desc")}>
        <PatternList
          label={t("op.watcher.ignore")}
          values={config.watcher.ignore}
          validate={() => null}
          onChange={(next) =>
            update((d) => ({ ...d, watcher: { ...d.watcher, ignore: next } }))
          }
        />
        <Toggle
          label={t("op.watcher.gitignore")}
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
      </>
      )}

      {sub === "agents" && (
      <Section
        title="Agents"
        description={t("op.agents.desc")}
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
                  {"labelKey" in agent ? t(agent.labelKey) : agent.label}
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
            <ScanSearch className="mr-1 h-3.5 w-3.5" />
            {t("op.agents.detect")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncStatus?.kind === "pending"}>
            {syncStatus?.kind === "pending" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            {t("op.agents.syncNow")}
          </Button>
          {syncStatus?.kind === "ok" && (
            <span className="text-[11px] text-(--ok-text)">
              {t("op.agents.syncDone", { n: syncStatus.updated })}
            </span>
          )}
          {syncStatus?.kind === "error" && (
            <span className="text-[11px] text-(--danger-text)">{syncStatus.message}</span>
          )}
        </div>
        {/* 「프로젝트 열 때 자동 감지」·「config 저장 시 자동 동기화」 토글은 뺐다 —
            감지와 동기화는 열 때 무조건 돌고 두 키를 읽는 코드가 없었다. */}
      </Section>
      )}

      {sub === "automation" && (
      <Section
        title={t("op.auto.title")}
        description={t("op.auto.desc")}
      >
        <Toggle
          label={t("op.auto.reconcile")}
          checked={config.agents.auto_reconcile ?? false}
          onChange={(v) =>
            update((d) => ({ ...d, agents: { ...d.agents, auto_reconcile: v } }))
          }
        />
        <p className="ml-6 text-[11px] leading-relaxed text-muted-foreground">
          {t("op.auto.reconcileDesc")}
        </p>
        <Toggle
          label={t("op.auto.draft")}
          checked={config.agents.auto_journal_draft ?? false}
          onChange={(v) =>
            update((d) => ({ ...d, agents: { ...d.agents, auto_journal_draft: v } }))
          }
        />
        <p className="ml-6 text-[11px] leading-relaxed text-muted-foreground">
          {t("op.auto.draftDesc")}
        </p>
      </Section>
      )}

      {sub === "integration" && (
      <>
        <Section
          title={t("op.scope.projectTitle")}
          description={
            projectName
              ? t("op.scope.projectDescNamed", { name: projectName })
              : t("op.scope.projectDesc")
          }
        >
          <ClaudeHooksBlock projectId={projectId} pluginInstalled={plugin?.installed ?? false} />
          <McpServerBlock projectId={projectId} pluginInstalled={plugin?.installed ?? false} />
        </Section>
        {/* 플러그인 번들 임포트 (Phase 6) — 프로젝트 스코프다. 놓이는 자리가
            전부 `<project>/.claude/` 와 `.mcp.json` 이기 때문이다. */}
        <PluginBundlesBlock projectId={projectId} />
        <Section
          title={t("op.scope.machineTitle")}
          description={t("op.scope.machineDesc")}
        >
          <ClaudePluginBlock plugin={plugin} />
          <AcpRuntimeBlock />
          <ShellIntegrationBlock />
        </Section>
      </>
      )}

      {sub === "logs" && <LogsSection />}
    </div>
  );
}

/**
 * PR-CI0 (docs/claude-integration/00-master-plan.md D1·D2) — Claude Code 훅
 * 연동 블록. `.claude/settings.local.json`(비공유, 로컬 전용)에 SessionStart /
 * Stop / SessionEnd 훅을 설치해 세션 감지를 파일와처 휴리스틱이 아닌 Claude
 * Code 의 실제 신호로 만든다. 상태는 디스크의 설정 파일이 SSOT — 별도 config
 * 플래그 없이 매번 읽는다.
 *
 * (export 는 테스트 전용 — claude_hooks_settings.test.tsx 가 Workspace/config
 * 부트스트랩 없이 이 블록만 단독 렌더한다.)
 */
export function ClaudeHooksBlock({
  projectId,
  pluginInstalled = false,
}: {
  projectId: number;
  /** 머신 전역 플러그인이 같은 훅을 이미 건다 — 겹침을 여기서도 고지한다. */
  pluginInstalled?: boolean;
}) {
  const { t } = useT();
  const [hooks, setHooks] = useState<ClaudeHooksStatus | null>(null);
  const [hooksError, setHooksError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void commands.claudeHooksStatus(projectId).then((res) => {
      if (res.status === "ok") {
        setHooks(res.data);
        setHooksError(null);
      } else {
        setHooksError(res.error);
      }
    });
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mutate = async (action: "install" | "uninstall") => {
    setBusy(true);
    try {
      const res =
        action === "install"
          ? await commands.claudeHooksInstall(projectId)
          : await commands.claudeHooksUninstall(projectId);
      if (res.status === "ok") {
        setHooks(res.data);
        setHooksError(null);
        toast.info(
          action === "install" ? t("op.hooks.on") : t("op.hooks.off"),
        );
      } else {
        setHooksError(res.error);
        toast.destructive(t("op.hooks.failed", { error: tError(res.error) }));
      }
    } finally {
      setBusy(false);
    }
  };

  const badge = hooksError
    ? { label: t("op.st.configError"), cls: "border-(--danger)/40 bg-(--danger-soft) text-(--danger-text)" }
    : !hooks
      ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
      : hooks.installed
        ? { label: t("op.st.linked"), cls: "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)" }
        : hooks.partial
          ? { label: t("op.st.drift"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
          : { label: t("op.st.off"), cls: "border-border bg-muted/30 text-muted-foreground" };

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("op.hooks.title")}
        </Label>
        <ScopeChip label={t("op.scope.project")} />
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>
          {badge.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {hooks && (hooks.installed || hooks.partial) ? (
            <>
              {hooks.partial && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate("install")}>
                  {t("op.reinstall")}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate("uninstall")}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {t("op.turnOff")}
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={busy || !!hooksError} onClick={() => void mutate("install")}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.turnOn")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("op.hooks.desc1")} <code className="text-[10px]">.claude/settings.local.json</code>{" "}
        {t("op.hooks.desc2")}
      </p>
      {pluginInstalled && (
        // 켜져 있으면 실제 이중 적재(경고), 꺼져 있으면 "켤 필요 없다"(정보).
        // 같은 사실이지만 사용자가 지금 해야 할 일이 다르므로 색을 나눈다.
        <p
          className={`text-[11px] leading-relaxed ${
            hooks?.installed || hooks?.partial ? "text-(--warn-text)" : "text-muted-foreground"
          }`}
        >
          {hooks?.installed || hooks?.partial
            ? t("op.hooks.pluginConflict")
            : t("op.hooks.pluginCovers")}
        </p>
      )}
      {hooks?.foreign_hooks && (
        <p className="text-[11px] text-muted-foreground">
          {t("op.hooks.custom")}
        </p>
      )}
      {hooksError && <p className="text-[11px] text-(--danger-text)">{hooksError}</p>}
    </div>
  );
}

/**
 * 터미널 셸 통합 (OSC 133/7) — 2026-07-30.
 *
 * 내장 터미널이 명령의 시작·끝·종료코드·작업 디렉터리를 알게 한다. 켜려면
 * 사용자 rc(`~/.zshrc` / `~/.bashrc`)에 **비활성 한 줄**을 심어야 하므로
 * 반드시 사용자가 직접 눌러야 한다 — 남의 dotfile 을 묻지 않고 고치지 않는다.
 *
 * 프로젝트가 아니라 머신 단위 설정이라 `projectId` 를 받지 않는다.
 */
export function ShellIntegrationBlock() {
  const { t } = useT();
  const [status, setStatus] = useState<ShellIntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void commands.shellIntegrationStatus().then((res) => {
      if (res.status === "ok") {
        setStatus(res.data);
        setError(null);
      } else {
        setError(tError(res.error));
      }
    });
  }, []);

  const mutate = async (action: "install" | "uninstall") => {
    setBusy(true);
    try {
      const res =
        action === "install"
          ? await commands.shellIntegrationInstall()
          : await commands.shellIntegrationUninstall();
      if (res.status === "ok") {
        setStatus(res.data);
        setError(null);
        toast.info(
          action === "install"
            ? t("op.shell.on")
            : t("op.shell.off"),
        );
      } else {
        setError(tError(res.error));
        toast.destructive(t("op.shell.failed", { error: tError(res.error) }));
      }
    } finally {
      setBusy(false);
    }
  };

  const unsupported = status?.shell === "unsupported";
  const badge = error
    ? { label: t("op.st.error"), cls: "border-(--danger)/40 bg-(--danger-soft) text-(--danger-text)" }
    : !status
      ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
      : unsupported
        ? { label: t("op.st.unsupportedShell"), cls: "border-border bg-muted/30 text-muted-foreground" }
        : status.block_broken
          ? { label: t("op.st.rcBroken"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
          : status.installed
            ? { label: t("op.st.on"), cls: "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)" }
            : { label: t("op.st.off"), cls: "border-border bg-muted/30 text-muted-foreground" };

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("op.shell.title")}
        </Label>
        <ScopeChip label={t("op.scope.machine")} />
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>
          {badge.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {status && !unsupported ? (
            status.installed ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate("uninstall")}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {t("op.turnOff")}
              </Button>
            ) : (
              <Button size="sm" disabled={busy || status.block_broken} onClick={() => void mutate("install")}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {t("op.turnOn")}
              </Button>
            )
          ) : null}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("op.shell.desc1")}
        {status?.rc_path ? (
          <>
            {" "}
            <code className="text-[10px]">{status.rc_path}</code> {t("op.shell.desc2")}
          </>
        ) : null}
      </p>
      {unsupported && (
        <p className="text-[11px] text-muted-foreground">
          {t("op.shell.unsupported")}
        </p>
      )}
      {status?.block_broken && (
        <p className="text-[11px] text-(--warn-text)">
          <code className="text-[10px]">oculpm:begin</code> /{" "}
          <code className="text-[10px]">oculpm:end</code> {t("op.shell.rcBrokenDesc")}
        </p>
      )}
      {error && <p className="text-[11px] text-(--danger-text)">{error}</p>}
    </div>
  );
}

/**
 * A3 — Claude Code 플러그인 (훅 + MCP + 스킬) 설치 감지.
 *
 * **머신 전역** 블록이다 — 플러그인은 `~/.claude/plugins` 에 설치되어 모든
 * 프로젝트에 한 번에 적용되므로 `projectId` 를 받지 않는다 (실제 동작은
 * 훅 커맨드의 `.oculpm` 존재 가드와 MCP 의 `--root ${CLAUDE_PROJECT_DIR}` 가
 * 프로젝트별로 갈라준다). 프로젝트별인 훅 토글·MCP 등록과 한 카드에 섞여
 * 있으면 "설치됨" 배지가 어느 범위를 말하는지 알 수 없어, 스코프 섹션이
 * 생기면서 별도 블록으로 떼어냈다.
 */
export function ClaudePluginBlock({ plugin }: { plugin: ClaudePluginStatus | null }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText("/plugin marketplace add bunhine0452/Ocul-PM");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.warning(t("op.copyFailed"));
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("op.plugin.title")}
        </Label>
        <ScopeChip label={t("op.scope.machine")} />
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] ${
            plugin?.installed
              ? "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)"
              : "border-border bg-muted/30 text-muted-foreground"
          }`}
        >
          {plugin == null ? t("op.st.checking") : plugin.installed ? t("op.plugin.installed") : t("op.plugin.notInstalled")}
        </span>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => void copyInstall()}>
            {copied ? t("common.copied") : t("op.plugin.copy")}
          </Button>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("op.plugin.desc1")} <code className="text-[10px]">/plugin marketplace add bunhine0452/Ocul-PM</code>{" "}
        {t("op.plugin.desc2")} <code className="text-[10px]">/plugin install oculpm@oculpm</code>{" "}
        {t("op.plugin.desc3")}
      </p>
      {plugin?.installed ? (
        <p className="text-[11px] text-(--warn-text)">{t("op.plugin.warn")}</p>
      ) : null}
    </div>
  );
}

/**
 * PR-CI2 (docs/claude-integration/00-master-plan.md D3) — oculpm-mcp 서버 등록
 * 블록. 프로젝트 `.mcp.json` 에 stdio 서버(journal_write/plan_status/
 * plan_update)를 등록해 Claude Code 가 파일 규격을 흉내 내는 대신 구조화
 * 도구로 기록하게 한다. Claude Desktop 은 원클릭으로
 * `claude_desktop_config.json` 에 같은 서버를 기입한다 (스니펫 복사는 폴백).
 * 둘 다 **프로젝트별** — 프로젝트를 바꾸면 각각 다시 등록해야 한다 (Desktop
 * 은 설정 파일이 머신에 하나지만 키가 `oculpm-<폴더명>` 이라 등록 행위는
 * 프로젝트 단위다).
 *
 * (export 는 테스트 전용 — mcp_settings.test.tsx.)
 */
export function McpServerBlock({
  projectId,
  pluginInstalled = false,
}: {
  projectId: number;
  /** 머신 전역 플러그인이 같은 MCP 서버를 이미 제공한다 (Desktop 은 제외). */
  pluginInstalled?: boolean;
}) {
  const { t } = useT();
  const [mcp, setMcp] = useState<McpRegistrationStatus | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [desk, setDesk] = useState<DesktopRegistrationStatus | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    void commands.mcpStatus(projectId).then((res) => {
      if (res.status === "ok") {
        setMcp(res.data);
        setMcpError(null);
      } else {
        setMcpError(res.error);
      }
    });
    void commands.mcpDesktopStatus(projectId).then((res) => {
      if (res.status === "ok") {
        setDesk(res.data);
        setDeskError(null);
      } else {
        setDeskError(res.error);
      }
    });
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mutate = async (action: "register" | "unregister") => {
    setBusy(true);
    try {
      const res =
        action === "register"
          ? await commands.mcpRegister(projectId)
          : await commands.mcpUnregister(projectId);
      if (res.status === "ok") {
        setMcp(res.data);
        setMcpError(null);
        // Claude Code 는 .mcp.json 을 세션 시작 시에만 읽는다 — 재시작 없이는
        // 등록/해제가 반영되지 않아 "해제했는데 도구가 계속 보이는" 혼란이 생긴다.
        toast.info(
          action === "register"
            ? t("op.mcp.registered")
            : t("op.mcp.unregistered"),
        );
      } else {
        setMcpError(res.error);
        toast.destructive(t("op.mcp.failed", { error: tError(res.error) }));
      }
    } finally {
      setBusy(false);
    }
  };

  const mutateDesktop = async (action: "register" | "unregister") => {
    setBusy(true);
    try {
      const res =
        action === "register"
          ? await commands.mcpDesktopRegister(projectId)
          : await commands.mcpDesktopUnregister(projectId);
      if (res.status === "ok") {
        setDesk(res.data);
        setDeskError(null);
        toast.info(
          action === "register"
            ? t("op.desk.registered")
            : t("op.desk.unregistered"),
        );
      } else {
        setDeskError(res.error);
        toast.destructive(t("op.desk.failed", { error: tError(res.error) }));
      }
    } finally {
      setBusy(false);
    }
  };

  const copySnippet = async () => {
    if (!mcp) return;
    try {
      await navigator.clipboard.writeText(mcp.desktop_snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.warning(t("op.copyFailedSnippet"));
    }
  };

  const badge = mcpError
    ? { label: t("op.st.configError"), cls: "border-(--danger)/40 bg-(--danger-soft) text-(--danger-text)" }
    : !mcp
      ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
      : mcp.registered
        ? { label: t("op.st.registered"), cls: "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)" }
        : !mcp.binary_found
          ? { label: t("op.st.noBinary"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
          : { label: t("op.st.unregistered"), cls: "border-border bg-muted/30 text-muted-foreground" };

  const deskBadge = deskError
    ? { label: t("op.st.configError"), cls: "border-(--danger)/40 bg-(--danger-soft) text-(--danger-text)" }
    : !desk
      ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
      : desk.registered
        ? { label: t("op.st.registered"), cls: "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)" }
        : !desk.installed
          ? { label: t("op.st.noDesktop"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
          : { label: t("op.st.unregistered"), cls: "border-border bg-muted/30 text-muted-foreground" };

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("op.mcp.title")}
        </Label>
        <ScopeChip label={t("op.scope.project")} />
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>
          {badge.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {mcp?.registered ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate("unregister")}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.unregister")}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || !!mcpError || !mcp?.binary_found}
              onClick={() => void mutate("register")}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.register")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("op.mcp.desc1")} <code className="text-[10px]">.mcp.json</code>{t("op.mcp.desc2")}
      </p>
      {mcp && !mcp.binary_found && (
        <p className="text-[11px] text-(--warn-text)">
          {t("op.mcp.noBinary1")}{" "}
              <code className="text-[10px]">cargo build --bin oculpm-mcp</code> {t("op.mcp.noBinary2")}
        </p>
      )}
      {pluginInstalled && (
        <p
          className={`text-[11px] leading-relaxed ${
            mcp?.registered ? "text-(--warn-text)" : "text-muted-foreground"
          }`}
        >
          {mcp?.registered ? t("op.mcp.pluginConflict") : t("op.mcp.pluginCovers")}
        </p>
      )}
      {mcp?.registered && (
        <p className="text-[11px] text-muted-foreground">
          {t("op.mcp.commitWarn1")} <code className="text-[10px]">.mcp.json</code>{" "}
              {t("op.mcp.commitWarn2")}
        </p>
      )}
      {mcpError && <p className="text-[11px] text-(--danger-text)">{mcpError}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Claude Desktop
        </Label>
        <ScopeChip label={t("op.scope.projectKey")} />
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${deskBadge.cls}`}>
          {deskBadge.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy || !mcp} onClick={() => void copySnippet()}>
            {copied ? t("common.copied") : t("op.desk.copy")}
          </Button>
          {desk?.registered ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutateDesktop("unregister")}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.desk.unregister")}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || !!deskError || !desk?.installed || !mcp?.binary_found}
              onClick={() => void mutateDesktop("register")}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.desk.register")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("op.desk.desc1")} <code className="text-[10px]">claude_desktop_config.json</code>{" "}
            {t("op.desk.desc2")} (<code className="text-[10px]">{desk?.server_key ?? "oculpm-…"}</code>){" "}
            {t("op.desk.desc3")}
      </p>
      {pluginInstalled && (
        // 플러그인은 Claude Code 만 구성한다 — Desktop 은 설정 파일도 등록
        // 경로도 다르다. 위 두 블록의 "플러그인이 이미 한다" 를 여기까지
        // 확대 적용하면 Desktop 을 영영 등록하지 않게 된다.
        <p className="text-[11px] text-muted-foreground">{t("op.desk.pluginNote")}</p>
      )}
      {desk && !desk.installed && (
        <p className="text-[11px] text-(--warn-text)">
          {t("op.desk.notFound")}
        </p>
      )}
      {deskError && <p className="text-[11px] text-(--danger-text)">{deskError}</p>}
    </div>
  );
}

// W4 dogfooding follow-up (2026-05-26) — Logs section. Shows the daily-rotated
// log dir path + a button to reveal it in Finder/Explorer. The user can then
// attach the latest `oculpm.log.YYYY-MM-DD` to a bug report. Uses the now-
// scope-permitted `opener:allow-reveal-item-in-dir` capability (발견 7).
function LogsSection() {
  const { t } = useT();
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
          t("op.logs.openFailedCopied", { msg }),
          { title: t("op.logs.openFailedTitle") },
        );
      } catch {
        toast.destructive(t("op.logs.openFailed", { msg }));
      }
    } finally {
      setRevealing(false);
    }
  }, [logDir]);

  return (
    <Section
      title={t("op.logs.title")}
      description={t("op.logs.desc")}
    >
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">
          {t("op.logs.location")}{" "}
          <span className="font-mono break-all text-foreground/80">
            {logDir ?? t("op.logs.disabled")}
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
          {t("op.logs.open")}
        </Button>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {t("op.logs.filenameLabel")}{" "}
          <code className="font-mono">oculpm.log.YYYY-MM-DD</code> — backend(rust)
          {t("op.logs.desc2")} <code>[FLOW]</code>{" "}
              {t("op.logs.desc3")}
        </p>
      </div>
    </Section>
  );
}

// ─── shared bits ────────────────────────────────────────────────────────────

/**
 * PR-ACP1 (docs/acp-panel/00-master-plan.md D2) — ACP 에이전트 런타임 블록.
 *
 * 에이전트 화면이 Claude Code 를 구동하려면 세 가지가 갖춰져야 한다: Node 18+,
 * `claude` CLI, 그리고 버전 고정된 ACP 어댑터. 셋을 "안 됨" 하나로 뭉치지 않고
 * 따로 보여주는 이유는 사용자가 할 수 있는 조치가 각각 다르기 때문이다.
 *
 * `path_source` 를 노출하는 것도 같은 이유다 — 패키징된 `.app` 은 PATH 가
 * 빈약해서 "터미널에선 되는데 앱에선 안 되는" 상황이 생기는데, 로그인 셸에서
 * 찾았다는 사실이 보이면 사용자가 그 차이를 이해할 수 있다.
 *
 * 프로젝트가 아니라 머신 단위 설정이라 `projectId` 를 받지 않는다.
 */
export function AcpRuntimeBlock() {
  const { t } = useT();
  const [diag, setDiag] = useState<AcpDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void commands.acpDiagnose().then((res) => {
      if (res.status === "ok") {
        setDiag(res.data);
        setError(null);
      } else {
        setError(tError(res.error));
      }
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const install = async () => {
    setBusy(true);
    try {
      const res = await commands.acpInstallAdapter();
      if (res.status === "ok") {
        setDiag(res.data);
        setError(null);
        toast.info(t("op.acp.installed"));
      } else {
        setError(tError(res.error));
        toast.destructive(t("op.acp.installFailed", { error: tError(res.error) }));
      }
    } finally {
      setBusy(false);
    }
  };

  const badge = error
    ? { label: t("op.st.configError"), cls: "border-(--danger)/40 bg-(--danger-soft) text-(--danger-text)" }
    : !diag
      ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
      : diag.ready
        ? { label: t("op.acp.ready"), cls: "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)" }
        : { label: t("op.acp.setupNeeded"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" };

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("op.acp.title")}
        </Label>
        <ScopeChip label={t("op.scope.machine")} />
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>
          {badge.label}
        </span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant={diag?.adapter_ok ? "outline" : "default"}
            disabled={busy || !diag}
            onClick={() => void install()}
          >
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            {diag?.adapter_ok ? t("op.acp.reinstall") : t("op.acp.install")}
          </Button>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("op.acp.desc")}</p>

      {diag && (
        <div className="space-y-1 pt-1">
          <AcpRow
            label={t("op.acp.node")}
            ok={diag.node_ok}
            value={
              diag.node_version
                ? `${diag.node_version}${diag.path_source === "login-shell" ? ` · ${t("op.acp.viaLoginShell")}` : ""}`
                : t("op.acp.missing")
            }
            hint={!diag.node_ok ? t("op.acp.needVersion", { n: diag.node_min_major }) : undefined}
          />
          {/* 딸려 온 것과 시스템 것을 구분해 보여 준다 — 사용자가 할 일이
              다르다. 딸려 온 것이면 따로 설치할 게 없고, 시스템 것이면 그쪽
              버전이 오르내리는 것을 우리가 못 막는다. */}
          <AcpRow
            label={t("op.acp.claude")}
            ok={!!diag.claude_path}
            value={
              diag.claude_path
                ? diag.claude_bundled
                  ? t("op.acp.claudeBundled")
                  : diag.claude_path
                : t("op.acp.missing")
            }
            hint={!diag.claude_path ? t("op.acp.claudeHint") : undefined}
          />
          <AcpRow
            label={t("op.acp.adapter")}
            ok={diag.adapter_ok}
            value={diag.adapter_version ?? t("op.acp.missing")}
            hint={
              diag.adapter_ok
                ? undefined
                : t("op.acp.adapterExpected", { version: diag.adapter_expected })
            }
          />
        </div>
      )}

      {error && <p className="text-[11px] text-(--danger-text)">{error}</p>}
    </div>
  );
}

function AcpRow({
  label,
  value,
  ok,
  hint,
}: {
  label: string;
  value: string;
  ok: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
      <span className={ok ? "text-(--ok-text)" : "text-(--warn-text)"}>{ok ? "●" : "○"}</span>
      <span className="text-muted-foreground">{label}</span>
      <code className="truncate text-[10px] text-foreground/80">{value}</code>
      {hint && <span className="text-[10px] text-muted-foreground">— {hint}</span>}
    </div>
  );
}

/**
 * 적용 범위 칩 — "이 프로젝트" / "이 머신 전체".
 *
 * 상태 배지(연동됨·등록됨…)와 **의도적으로 다르게** 생겼다: 색 없는 파선
 * 테두리. 색이 있으면 상태로 읽히고, 한 헤더에 배지가 둘 있는 것처럼 보인다.
 * 섹션 머리말이 이미 범위를 말하지만 칩을 따로 다는 이유는, 스크롤 중에는
 * 머리말이 화면 밖으로 나가 배지만 남기 때문이다.
 */
function ScopeChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}

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
  const { t } = useT();
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
              aria-label={t("op.delete")}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            {errors[i] && (
              <span className="text-[10px] text-(--danger-text)">{errors[i]}</span>
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
          placeholder={t("op.patternPlaceholder")}
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
