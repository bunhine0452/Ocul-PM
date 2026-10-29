/**
 * 설정 · 에이전트 연결 — 기록은 에이전트가 남기고, 앱은 그것을 보여 준다.
 *
 * 앱이 직접 설치하지 않는다 — 플러그인은 각 CLI 가 마켓플레이스를 받아 캐시까지
 * 펼쳐야 완성되므로(설정 파일만 흉내 내면 반쪽 상태), 여기서는 **상태를 읽고 붙여
 * 넣을 명령을 준다**. 할 일이 없는 행은 세우지 않는다 — Codex 가 없는 기기의 Codex 행, Windows 밖의
 * 「MCP 직접 등록」, 연결할 것이 없는 Cursor·Gemini CLI(AGENTS.md 하나로 기록한다).
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
import { PrefsCard, PrefsRow } from "./prefsUi";

/** 아직 묻는 중 · 물었는데 모름 · 답. */
type Probe<T> = { state: "loading" } | { state: "unknown" } | { state: "ok"; value: T };

function ClaudeRow() {
  const { t } = useT();
  const projectId = useOptionalWorkspace()?.state.currentProjectId ?? null;
  const [probe, setProbe] = useState<Probe<ClaudePluginStatus>>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    void claudeInstallApi.pluginStatus(projectId).then((s) => {
      if (alive) setProbe(s ? { state: "ok", value: s } : { state: "unknown" });
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  let body;
  if (probe.state === "loading") body = <span className="prefs-dim">{t("prefs.checking")}</span>;
  else if (probe.state === "unknown") body = <span className="prefs-dim">{t("prefs.unknown")}</span>;
  else if (!probe.value.installed)
    body = (
      <>
        <span className="chip sm">{t("prefs.agents.notInstalled")}</span>
        <CopyCommand lines={CLAUDE_PLUGIN_INSTALL} label={t("prefs.agents.installCmd")} />
      </>
    );
  else if (probe.value.behind)
    body = (
      <>
        <span className="chip sm warn">
          {t("prefs.agents.behind", {
            installed: probe.value.installed_version ?? "?",
            bundled: probe.value.bundled_version,
          })}
        </span>
        <CopyCommand lines={CLAUDE_PLUGIN_UPDATE} label={t("prefs.agents.updateCmd")} />
      </>
    );
  else
    body = (
      <>
        <span className="chip sm ok">{t("prefs.agents.connected")}</span>
        {probe.value.installed_version ? <span className="prefs-dim mono">{probe.value.installed_version}</span> : null}
      </>
    );

  return (
    <PrefsRow label={t("prefs.agents.claude")} meta={t("prefs.agents.claudeMeta")}>
      {body}
    </PrefsRow>
  );
}

function CodexRow() {
  const { t } = useT();
  const [probe, setProbe] = useState<Probe<CodexPluginStatus>>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(() => oculpmApi.codexPluginStatus())
      .then((s) => alive && setProbe({ state: "ok", value: s }))
      .catch(() => alive && setProbe({ state: "unknown" }));
    return () => {
      alive = false;
    };
  }, []);

  let body;
  if (probe.state === "loading") body = <span className="prefs-dim">{t("prefs.checking")}</span>;
  else if (probe.state === "unknown") body = <span className="prefs-dim">{t("prefs.unknown")}</span>;
  else {
    const c = probe.value;
    const installed = c.enabled && !!c.cached_version;
    // 고아 — 플러그인 항목은 있는데 그 마켓플레이스가 설정에 없다. Codex 는 조용히 못 싣는다.
    const orphaned = c.enabled && !c.marketplace_configured;
    // Codex 가 없는 기기에는 이 행이 없다 — 「없어요」 한 줄은 할 일이 아니다.
    if (!c.codex_installed) return null;
    if (orphaned)
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
          <span className="prefs-dim mono">{c.cached_version}</span>
        </>
      );
    else
      body = (
        <>
          <span className="chip sm">{t("prefs.agents.notInstalled")}</span>
          <CopyCommand lines={CODEX_PLUGIN_INSTALL} label={t("prefs.agents.installCmd")} />
        </>
      );
  }

  return (
    <PrefsRow label={t("prefs.agents.codex")} meta={t("prefs.agents.codexMeta")}>
      {body}
    </PrefsRow>
  );
}

/**
 * 플러그인의 MCP 가 뜨지 않는 환경(Windows 등)의 우회로 — 이 프로젝트의 `.mcp.json` 에
 * 사이드카를 직접 등록한다. 플러그인이 MCP 를 띄우는 곳에서 둘 다 켜면 같은 도구가 두 벌
 * 보이므로, 필요할 때만 쓰라고 메타에 적는다.
 */
function McpRow() {
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
      .catch(() => alive && setProbe({ state: "unknown" }));
    return () => {
      alive = false;
    };
  }, [projectId]);
  if (projectId == null) return null;
  // Windows 의 우회로다 — 다른 OS 에서는 이미 등록해 둔 경우(풀 수 있어야 한다)에만 선다.
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

  let body;
  if (probe.state === "loading") body = <span className="prefs-dim">{t("prefs.checking")}</span>;
  else if (probe.state === "unknown") body = <span className="prefs-dim">{t("prefs.unknown")}</span>;
  else if (probe.value.registered)
    body = (
      <>
        <span className="chip sm ok">{t("prefs.agents.mcpRegistered")}</span>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void toggle(false)}>
          {t("prefs.agents.mcpUnregister")}
        </button>
      </>
    );
  else if (!probe.value.binary_found) body = <span className="prefs-dim">{t("prefs.agents.mcpNoBinary")}</span>;
  else
    body = (
      <button type="button" className="btn sm" disabled={busy} onClick={() => void toggle(true)}>
        {t("prefs.agents.mcpRegister")}
      </button>
    );

  return (
    <PrefsRow label={t("prefs.agents.mcp")} meta={t("prefs.agents.mcpMeta")}>
      {body}
    </PrefsRow>
  );
}

export function AgentsSection({ id }: { id: string }) {
  const { t } = useT();
  return (
    <PrefsCard id={id} title={t("prefs.agents.title")}>
      <ClaudeRow />
      <CodexRow />
      <McpRow />
    </PrefsCard>
  );
}
