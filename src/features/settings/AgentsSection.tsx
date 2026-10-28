/**
 * 설정 · 에이전트 연결 — 기록은 에이전트가 남기고, 앱은 그것을 보여 준다.
 *
 * 앱이 직접 설치하지 않는다 — 플러그인은 각 CLI 가 마켓플레이스를 받아 캐시까지
 * 펼쳐야 완성되므로(설정 파일만 흉내 내면 반쪽 상태), 여기서는 **상태를 읽고 붙여
 * 넣을 명령을 준다**. Cursor·Gemini CLI 는 연결할 것이 없다 — AGENTS.md 하나로 기록한다.
 */
import { useEffect, useState } from "react";

import { claudeInstallApi } from "@/api/claudeSurface";
import { oculpmApi } from "@/api/oculpm";
import { CopyCommand } from "@/components/CopyCommand";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";
import type { ClaudePluginStatus, CodexPluginStatus } from "@/lib/bindings";
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
        <span className="chip sm accent">{t("prefs.agents.connected")}</span>
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
    if (!c.codex_installed) body = <span className="prefs-dim">{t("prefs.agents.noCodex")}</span>;
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
          <span className="chip sm accent">{t("prefs.agents.connected")}</span>
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

export function AgentsSection({ id }: { id: string }) {
  const { t } = useT();
  return (
    <PrefsCard id={id} title={t("prefs.agents.title")} note={t("prefs.agents.note")}>
      <ClaudeRow />
      <CodexRow />
      <PrefsRow label={t("prefs.agents.others")} meta={t("prefs.agents.othersMeta")}>
        <span className="prefs-dim">{t("prefs.agents.othersBody")}</span>
      </PrefsRow>
    </PrefsCard>
  );
}
