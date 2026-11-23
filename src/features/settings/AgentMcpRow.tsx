/**
 * 설정 · 에이전트 — Cursor · Gemini CLI 의 기록 도구(MCP) 등록 (love-round-20261123, 사용자 결정 11-23).
 *
 * 두 도구는 플러그인이 없고 Claude 의 `.mcp.json` 도 읽지 않는다. 그래서 그 프로젝트의
 * `.cursor/mcp.json` · `.gemini/settings.json` 에 서버 하나를 **누를 때만** 제자리 병합한다
 * (`oculpm/mcp/agent_json.rs` — 모르는 키 · 순서 보존, 못 읽는 파일은 덮지 않고 경로와 이유를 말한다).
 *
 * 할 일이 없는 행은 세우지 않는다(같은 칸의 Codex 행과 같은 규칙): 이 프로젝트나 이 기기에서 그 도구의
 * 흔적을 못 찾았고 등록도 안 돼 있으면 없다. 설정 파일을 못 읽으면 그 이유를 행에 그대로 둔다 — 흔적이
 * 있다는 뜻이고, 「모름」 으로 뭉개면 사람이 고칠 곳을 모른다.
 */
import { useEffect, useState } from "react";

import { toAppError } from "@/api/invoke";
import { OculpmApiError, oculpmApi } from "@/api/oculpm";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useT, type I18nKey } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { AgentMcpStatus, AgentMcpTarget } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { PrefsRow } from "./prefsUi";

const LABELS: Record<AgentMcpTarget, { label: I18nKey; meta: I18nKey }> = {
  cursor: { label: "prefs.agents.cursor", meta: "prefs.agents.cursorMeta" },
  gemini: { label: "prefs.agents.gemini", meta: "prefs.agents.geminiMeta" },
};

type Probe = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; value: AgentMcpStatus };

export function AgentMcpRow({ target, tick }: { target: AgentMcpTarget; tick: number }) {
  const { t } = useT();
  const projectId = useOptionalWorkspace()?.state.currentProjectId ?? null;
  const [probe, setProbe] = useState<Probe>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (projectId == null) return;
    let alive = true;
    void Promise.resolve()
      .then(() => oculpmApi.agentMcpStatus(projectId, target))
      .then((s) => alive && setProbe({ state: "ok", value: s }))
      .catch((e: unknown) => {
        if (!alive) return;
        // 백엔드가 말한 이유(못 읽는 설정 파일)만 행에 싣는다. 그 밖의 실패는 알던 답을 둔다.
        if (e instanceof OculpmApiError) setProbe({ state: "error", message: tError(toAppError(e)) });
      });
    return () => {
      alive = false;
    };
  }, [projectId, target, tick]);

  if (projectId == null || probe.state === "loading") return null;
  if (probe.state === "ok" && !probe.value.detected && !probe.value.registered) return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const next = on
        ? await oculpmApi.agentMcpRegister(projectId, target)
        : await oculpmApi.agentMcpUnregister(projectId, target);
      setProbe({ state: "ok", value: next });
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  let body = null;
  let actions = null;
  if (probe.state === "error") body = <span className="prefs-dim">{probe.message}</span>;
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
    <PrefsRow label={t(LABELS[target].label)} meta={t(LABELS[target].meta)} actions={actions}>
      {body}
    </PrefsRow>
  );
}
