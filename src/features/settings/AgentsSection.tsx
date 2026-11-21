/**
 * 설정 · 에이전트 — 기록은 에이전트가 남기고, 앱은 그것을 보여 준다.
 *
 * 앱이 직접 설치하지 않는다 — 플러그인은 각 CLI 가 마켓플레이스를 받아 캐시까지
 * 펼쳐야 완성되므로(설정 파일만 흉내 내면 반쪽 상태), 여기서는 **상태를 읽고 붙여
 * 넣을 명령을 준다**. 할 일이 없는 행은 세우지 않는다 — Codex 가 없는 기기의 Codex 행, Windows 밖의
 * 「MCP 직접 등록」, 연결할 것이 없는 Cursor·Gemini CLI(AGENTS.md 하나로 기록한다).
 *
 * 11-15 (#settings-status): 설치 명령을 터미널에서 돌리고 돌아와도 「설치 안 됨」 에 머물렀다 — 창이
 * 앞으로 오거나 다시 보이면 다시 묻고, 칸 머리에 「다시 확인」 이 있다. 설치 안 됨 · 뒤처짐은 경고 칩이고
 * 맨 위 「고칠 것」 에 올라간다. 판 번호는 mono.
 */
import { useEffect, useState } from "react";

import { claudeInstallApi } from "@/api/claudeSurface";
import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { CopyCommand } from "@/components/CopyCommand";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { ClaudePluginStatus, CodexPluginStatus, McpRegistrationStatus } from "@/lib/bindings";
import { getPlatform } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { CLAUDE_PLUGIN_INSTALL, CLAUDE_PLUGIN_UPDATE, CODEX_PLUGIN_INSTALL } from "@/lib/agentCommands";
import { ClaudeThemeRow } from "./ClaudeThemeRow";
import { PrefsCard, PrefsRow, useReportFix } from "./prefsUi";

/** 아직 묻는 중 · 물었는데 모름 · 답. */
type Probe<T> = { state: "loading" } | { state: "unknown" } | { state: "ok"; value: T };

/** 다시 물을 때 — 창이 앞으로 오거나(focus) 다시 보일 때(visibilitychange), 또는 「다시 확인」. */
function useRecheck(): [number, () => void] {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return [tick, () => setTick((n) => n + 1)];
}

function ClaudeRow({ tick }: { tick: number }) {
  const { t } = useT();
  const projectId = useOptionalWorkspace()?.state.currentProjectId ?? null;
  const [probe, setProbe] = useState<Probe<ClaudePluginStatus>>({ state: "loading" });
  // 다시 물을 때는 지금 답을 둔 채 묻는다 — 창을 앞으로 가져올 때마다 「확인 중」 이 깜빡이지 않게. 다시 묻기가
  // 한 번 실패해도(null) 알고 있던 답을 둔다: 덮으면 맨 위 「고칠 것」 의 플러그인 뒤처짐까지 내려갔다(Codex · MCP 와 같은 규칙).
  useEffect(() => {
    let alive = true;
    void claudeInstallApi.pluginStatus(projectId).then((s) => {
      if (alive) setProbe((p) => (s ? { state: "ok", value: s } : p.state === "ok" ? p : { state: "unknown" }));
    });
    return () => {
      alive = false;
    };
  }, [projectId, tick]);

  const v = probe.state === "ok" ? probe.value : null;
  const label = t("prefs.agents.claude");
  const behind = v?.installed && v.behind ? `${v.installed_version ?? "?"} → ${v.bundled_version}` : null;
  useReportFix(
    "claude",
    !v
      ? null
      : !v.installed
        ? { section: "agents", label, detail: t("prefs.agents.notInstalled") }
        : behind
          ? { section: "agents", label, detail: behind, mono: true }
          : null,
  );

  let body;
  if (probe.state === "loading") body = <span className="prefs-dim">{t("prefs.checking")}</span>;
  else if (!v) body = <span className="prefs-dim">{t("prefs.unknown")}</span>;
  else if (!v.installed)
    body = (
      <>
        <span className="chip sm warn">{t("prefs.agents.notInstalled")}</span>
        <CopyCommand lines={CLAUDE_PLUGIN_INSTALL} label={t("prefs.agents.installCmd")} />
      </>
    );
  else if (behind)
    body = (
      <>
        <span className="chip sm warn">{t("prefs.agents.behind")}</span>
        <span className="prefs-ver mono">{behind}</span>
        <CopyCommand lines={CLAUDE_PLUGIN_UPDATE} label={t("prefs.agents.updateCmd")} />
      </>
    );
  else
    body = (
      <>
        <span className="chip sm ok">{t("prefs.agents.connected")}</span>
        {v.installed_version ? <span className="prefs-ver mono">{v.installed_version}</span> : null}
      </>
    );

  return (
    <PrefsRow label={label} meta={t("prefs.agents.claudeMeta")}>
      {body}
    </PrefsRow>
  );
}

function CodexRow({ tick }: { tick: number }) {
  const { t } = useT();
  const [probe, setProbe] = useState<Probe<CodexPluginStatus>>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(() => oculpmApi.codexPluginStatus())
      .then((s) => alive && setProbe({ state: "ok", value: s }))
      .catch(() => alive && setProbe((p) => (p.state === "ok" ? p : { state: "unknown" })));
    return () => {
      alive = false;
    };
  }, [tick]);

  const c = probe.state === "ok" ? probe.value : null;
  const installed = !!c && c.enabled && !!c.cached_version;
  // 고아 — 플러그인 항목은 있는데 그 마켓플레이스가 설정에 없다. Codex 는 조용히 못 싣는다.
  const orphaned = !!c && c.enabled && !c.marketplace_configured;
  const label = t("prefs.agents.codex");
  useReportFix(
    "codex",
    !c?.codex_installed || installed
      ? null
      : { section: "agents", label, detail: orphaned ? t("prefs.agents.orphan") : t("prefs.agents.notInstalled") },
  );

  let body;
  if (probe.state === "loading") body = <span className="prefs-dim">{t("prefs.checking")}</span>;
  else if (!c) body = <span className="prefs-dim">{t("prefs.unknown")}</span>;
  // Codex 가 없는 기기에는 이 행이 없다 — 「없어요」 한 줄은 할 일이 아니다.
  else if (!c.codex_installed) return null;
  else if (orphaned)
    body = (
      <>
        <span className="chip sm warn">{t("prefs.agents.orphan")}</span>
        <CopyCommand lines={CODEX_PLUGIN_INSTALL} label={t("prefs.agents.installCmd")} />
      </>
    );
  else if (installed)
    body = (
      <>
        <span className="chip sm ok">{t("prefs.agents.connected")}</span>
        <span className="prefs-ver mono">{c.cached_version}</span>
      </>
    );
  else
    body = (
      <>
        <span className="chip sm warn">{t("prefs.agents.notInstalled")}</span>
        <CopyCommand lines={CODEX_PLUGIN_INSTALL} label={t("prefs.agents.installCmd")} />
      </>
    );

  return (
    <PrefsRow label={label} meta={t("prefs.agents.codexMeta")}>
      {body}
    </PrefsRow>
  );
}

/**
 * 플러그인 없이 쓰거나 플러그인이 옛 판(4.12 미만 — Windows 에서 MCP 가 뜨지 않던 판)일 때의
 * 우회로 — 이 프로젝트의 `.mcp.json` 에 사이드카를 직접 등록한다. 4.12 부터는 플러그인의 MCP 가
 * Windows 에서도 뜨므로(`plugin/oculpm/bin/Windows_NT/oculpm-mcp.cmd`) 둘 다 켜면 같은 도구가
 * 두 벌 보인다 — 필요할 때만 쓰라고 메타에 적는다.
 */
function McpRow({ tick }: { tick: number }) {
  const { t } = useT();
  const projectId = useOptionalWorkspace()?.state.currentProjectId ?? null;
  const [probe, setProbe] = useState<Probe<McpRegistrationStatus>>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (projectId == null) return;
    let alive = true;
    void Promise.resolve()
      .then(() => oculpmApi.mcpStatus(projectId))
      .then((s) => alive && setProbe({ state: "ok", value: s }))
      .catch(() => alive && setProbe((p) => (p.state === "ok" ? p : { state: "unknown" })));
    return () => {
      alive = false;
    };
  }, [projectId, tick]);
  if (projectId == null) return null;
  // Windows 에서는 옛 플러그인을 쓰는 사람을 위해 늘 선다 — 다른 OS 에서는 이미 등록해 둔 경우(풀 수 있어야 한다)에만.
  const registered = probe.state === "ok" && probe.value.registered;
  if (getPlatform() !== "windows" && !registered) return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const next = on ? await oculpmApi.mcpRegister(projectId) : await oculpmApi.mcpUnregister(projectId);
      setProbe({ state: "ok", value: next });
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  let body = null;
  let actions = null;
  if (probe.state === "loading") body = <span className="prefs-dim">{t("prefs.checking")}</span>;
  else if (probe.state === "unknown") body = <span className="prefs-dim">{t("prefs.unknown")}</span>;
  else if (probe.value.registered) {
    body = <span className="chip sm ok">{t("prefs.agents.mcpRegistered")}</span>;
    actions = (
      <button type="button" className="btn sm prefs-unreg" disabled={busy} onClick={() => void toggle(false)}>
        {t("prefs.agents.mcpUnregister")}
      </button>
    );
  } else if (!probe.value.binary_found) body = <span className="prefs-dim">{t("prefs.agents.mcpNoBinary")}</span>;
  else
    actions = (
      <button type="button" className="btn sm" disabled={busy} onClick={() => void toggle(true)}>
        {t("prefs.agents.mcpRegister")}
      </button>
    );

  return (
    <PrefsRow label={t("prefs.agents.mcp")} meta={t("prefs.agents.mcpMeta")} actions={actions}>
      {body}
    </PrefsRow>
  );
}

export function AgentsSection({ id, arrived }: { id: string; arrived?: number }) {
  const { t } = useT();
  const [tick, recheck] = useRecheck();
  return (
    <PrefsCard
      id={id}
      title={t("prefs.agents.title")}
      arrived={arrived}
      action={
        <button type="button" className="btn sm" onClick={recheck}>
          {t("prefs.recheck")}
        </button>
      }
    >
      <ClaudeRow tick={tick} />
      <ClaudeThemeRow tick={tick} />
      <CodexRow tick={tick} />
      <McpRow tick={tick} />
    </PrefsCard>
  );
}
