/**
 * 설정 · 에이전트의 Claude Code 플러그인 행 — **이 프로젝트에** 켜진 설치가 있을 때만 「연결됨」.
 *
 * 11-23 (#plugin-detect-false-positive): 예전엔 마켓플레이스만 더했거나 다른 프로젝트에만 깔았어도 「연결됨」 이었다.
 * 이제 상태는 오늘의 첫 걸음 · 계획 빈 화면과 같은 판정(`pluginConnection`)이고, 상태마다 붙여 넣을 명령이
 * 다르다(마켓만 더한 사람에게 마켓 줄을 다시 주지 않는다). 연결됐어도 판이 어긋나면 말한다 — 플러그인이 옛
 * 판이면 올릴 명령을, 앱이 옛 판이면(#plugin-ahead-of-app) 업데이트 칸으로 가는 단추를. 다른 프로젝트의 옛 판
 * 수는 이 프로젝트의 고칠 것이 아니라 흐린 한 줄이다(#plugin-skew-visible-to-agent).
 */
import { useEffect, useState } from "react";

import { claudeInstallApi } from "@/api/claudeSurface";
import { CopyCommand } from "@/components/CopyCommand";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useT, type I18nKey } from "@/i18n";
import { CLAUDE_PLUGIN_UPDATE } from "@/lib/agentCommands";
import type { ClaudePluginStatus } from "@/lib/bindings";
import { getPlatform } from "@/lib/platform";
import { commandLabelKey, pluginConnection, type PluginConnection } from "@/lib/pluginConnection";
import { openSettings } from "@/lib/settingsNav";
import { PrefsRow, useReportFix } from "./prefsUi";

/** 아직 묻는 중 · 물었는데 모름 · 답. */
type Probe<T> = { state: "loading" } | { state: "unknown" } | { state: "ok"; value: T };

/** 연결 안 된 상태의 칩 낱말. */
const CHIP: Record<Exclude<PluginConnection["kind"], "connected">, I18nKey> = {
  notInstalled: "prefs.agents.notInstalled",
  marketplaceOnly: "prefs.agents.marketplaceOnly",
  otherProject: "prefs.agents.otherProject",
  disabled: "prefs.agents.disabled",
  windowsOld: "prefs.agents.windowsOld",
  unreachable: "prefs.agents.unreachable",
};

export function ClaudePluginRow({ tick }: { tick: number }) {
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
  const conn = pluginConnection(v, getPlatform());
  const label = t("prefs.agents.claude");
  const connected = conn?.kind === "connected";
  const behind = connected && v?.behind ? `${v.installed_version ?? "?"} → ${v.bundled_version}` : null;
  const ahead = connected && v?.ahead && !v.behind ? `${v.bundled_version} → ${v.installed_version ?? "?"}` : null;
  useReportFix(
    "claude",
    !conn
      ? null
      : conn.kind !== "connected"
        ? { section: "agents", label, detail: t(CHIP[conn.kind]) }
        : behind
          ? { section: "agents", label, detail: behind, mono: true }
          : ahead
            ? { section: "agents", label, detail: t("prefs.agents.ahead") }
            : null,
  );

  let body;
  let actions = null;
  if (probe.state === "loading") body = <span className="prefs-dim">{t("prefs.checking")}</span>;
  else if (!v || !conn) body = <span className="prefs-dim">{t("prefs.unknown")}</span>;
  else if (conn.kind === "unreachable")
    body = (
      <>
        <span className="chip sm warn">{t(CHIP.unreachable)}</span>
        <span className="prefs-dim">
          {t(getPlatform() === "mac" ? "prefs.agents.unreachableMac" : "prefs.agents.unreachableOther")}
        </span>
      </>
    );
  else if (conn.kind !== "connected")
    body = (
      <>
        <span className="chip sm warn">{t(CHIP[conn.kind])}</span>
        <CopyCommand lines={conn.lines} label={t(commandLabelKey(conn.kind))} />
        <span className="prefs-dim">{t("prefs.agents.restartHint")}</span>
      </>
    );
  else if (behind)
    body = (
      <>
        <span className="chip sm warn">{t("prefs.agents.behind")}</span>
        <span className="prefs-ver mono">{behind}</span>
        <CopyCommand lines={CLAUDE_PLUGIN_UPDATE} label={t("prefs.agents.updateCmd")} />
        <span className="prefs-dim">{t("prefs.agents.restartHint")}</span>
      </>
    );
  else if (ahead) {
    body = (
      <>
        <span className="chip sm warn">{t("prefs.agents.ahead")}</span>
        <span className="prefs-ver mono">{ahead}</span>
        <span className="prefs-dim">{t("prefs.agents.aheadHint")}</span>
      </>
    );
    actions = (
      <button type="button" className="btn sm" onClick={() => openSettings("data")}>
        {t("prefs.agents.seeUpdate")}
      </button>
    );
  } else
    body = (
      <>
        <span className="chip sm ok">{t("prefs.agents.connected")}</span>
        {v.installed_version ? <span className="prefs-ver mono">{v.installed_version}</span> : null}
      </>
    );

  const others = v && v.other_behind > 0 ? t("prefs.agents.otherBehind", { n: v.other_behind }) : null;
  return (
    <PrefsRow label={label} meta={t("prefs.agents.claudeMeta")} actions={actions}>
      {body}
      {others ? <span className="prefs-dim">{others}</span> : null}
    </PrefsRow>
  );
}
