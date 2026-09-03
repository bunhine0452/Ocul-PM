// 닥터 — 이 프로젝트에서 ocul-pm 이 돌아가는 데 필요한 것들의 한 표
// (완성도 라운드 Phase 2, 2026-08-30).
//
// 예전 진단 탭은 DB 크기와 피드백 버튼뿐이었다. "AI 가 일지를 써도 화면이 안
// 바뀐다" 같은 증상을 겪은 사람이 워처·락·훅·색인 중 어디가 막혔는지 알 곳이
// 없었다 — 각각은 다른 탭 구석에 흩어져 있거나(셸 통합·훅·MCP) 아예 안 보였다
// (락 상태·마지막 색인 시각). 여기 한 표로 모으고, 고칠 수 있는 행엔 그 자리에서
// 누르는 버튼을 단다. 아래엔 이번 세션의 무결성 경고 목록 — 토스트로만 지나가던
// 것이다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Stethoscope } from "@/components/Icons";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { automationApi } from "@/api/automation";
import { formatAt } from "../automation/automationModel";
import { useT } from "@/i18n";
import type { I18nKey } from "@/i18n";
import {
  commands,
  type AcpDiagnostics,
  type AutomationOverview,
  type OculpmStatus,
  type ProjectStats,
} from "@/lib/bindings";
import { clearIntegrityLog, useIntegrityLog } from "@/lib/integrityLog";
import { requestOculpmActivate, requestReindex } from "@/lib/projectActions";
import { openSettings } from "@/lib/settingsNav";
import { coreModelTarget, PROVIDERS, type Provider } from "@/lib/settings";
import { toast } from "@/lib/toast";
import type { Envelope } from "@/api/invoke";
import { tError } from "@/i18n/errors";
import { relativeTime } from "@/features/chat/relativeTime";
import { Section, secretName } from "./ui";

type RowState = "ok" | "warn" | "danger" | "off";

interface DoctorRow {
  id: string;
  labelKey: I18nKey;
  state: RowState;
  value: string;
  action?: { labelKey: I18nKey; run: () => void | Promise<void> };
}

interface Probe {
  status: OculpmStatus | null;
  acp: AcpDiagnostics | null;
  keys: Provider[];
  stats: ProjectStats | null;
  shell: { installed: boolean; block_broken: boolean } | null;
  hooks: { installed: boolean; partial: boolean } | null;
  mcp: { registered: boolean; binary_found: boolean } | null;
  /** 자동화 한 벌 (Phase 3 `#doctor-automation`). 실패하면 그 행들만 "확인 실패". */
  automation: AutomationOverview | null;
}

/** 실패한 조사는 `null` — 행은 "확인 실패" 로 남고 나머지 행은 정상 표시된다. */
async function probe(projectId: number): Promise<Probe> {
  const ok = <T,>(p: Promise<Envelope<T>>) =>
    p.then((r) => (r.status === "ok" ? r.data : null)).catch(() => null);
  const [status, acp, keyFlags, stats, shell, hooks, mcp, automation] = await Promise.all([
    ok(commands.oculpmGetStatus(projectId)),
    ok(commands.acpDiagnose()),
    Promise.all(PROVIDERS.map((p) => ok(commands.secretHas(secretName(p))).then((has) => (has ? p : null)))),
    ok(commands.projectStats(projectId)),
    ok(commands.shellIntegrationStatus()),
    ok(commands.claudeHooksStatus(projectId)),
    ok(commands.mcpStatus(projectId)),
    // `automationApi` 는 봉투 대신 던진다 — 여기만 형태가 달라 따로 삼킨다.
    automationApi.overview(projectId).catch(() => null),
  ]);
  return {
    status,
    acp,
    keys: keyFlags.filter((p): p is Provider => p != null),
    stats,
    shell,
    hooks,
    mcp,
    automation,
  };
}

const DOT: Record<RowState, string> = {
  ok: "bg-[var(--ok)]",
  warn: "bg-(--warn)",
  danger: "bg-(--danger)",
  off: "bg-muted-foreground/40",
};

export function DoctorSection() {
  const { t } = useT();
  const { settings } = useSettings();
  const ws = useOptionalWorkspace();
  const projectId = ws?.state.currentProjectId ?? null;
  const indexing = projectId != null && ws?.state.indexingProjectId === projectId;
  const [report, setReport] = useState<Probe | null>(null);
  const [checking, setChecking] = useState(false);
  const log = useIntegrityLog();
  const warnings = useMemo(() => log.filter((w) => w.projectId === projectId), [log, projectId]);

  const check = useCallback(async () => {
    if (projectId == null) return;
    setChecking(true);
    setReport(await probe(projectId));
    setChecking(false);
  }, [projectId]);

  useEffect(() => {
    void check();
  }, [check]);

  // 색인이 끝나면 색인 행이 저절로 새로 읽힌다.
  useEffect(() => {
    if (!indexing && report) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexing]);

  const rows = useMemo<DoctorRow[]>(() => {
    if (!report || projectId == null) return [];
    const unknown = t("settings.doctor.v.unknown");
    const out: DoctorRow[] = [];
    const s = report.status;

    out.push(
      !s
        ? { id: "oculpm", labelKey: "settings.doctor.oculpm", state: "off", value: unknown }
        : !s.initialized
          ? {
              id: "oculpm",
              labelKey: "settings.doctor.oculpm",
              state: "warn",
              value: t("settings.doctor.v.inactive"),
              action: { labelKey: "settings.doctor.a.activate", run: () => requestOculpmActivate() },
            }
          : !s.config_valid
            ? { id: "oculpm", labelKey: "settings.doctor.oculpm", state: "danger", value: t("settings.doctor.v.configInvalid") }
            : { id: "oculpm", labelKey: "settings.doctor.oculpm", state: "ok", value: t("settings.doctor.v.active") },
    );

    const restart = async () => {
      const r = await commands.oculpmWatcherStart(projectId);
      if (r.status === "error") toast.destructive(t("settings.doctor.a.failed", { error: tError(r.error) }));
      await check();
    };
    out.push(
      !s
        ? { id: "watcher", labelKey: "settings.doctor.watcher", state: "off", value: unknown }
        : s.watcher_state === "running"
          ? { id: "watcher", labelKey: "settings.doctor.watcher", state: "ok", value: t("settings.doctor.v.running") }
          : s.watcher_state === "error"
            ? { id: "watcher", labelKey: "settings.doctor.watcher", state: "danger", value: t("settings.doctor.v.error"), action: { labelKey: "settings.doctor.a.start", run: restart } }
            : { id: "watcher", labelKey: "settings.doctor.watcher", state: "warn", value: t("settings.doctor.v.stopped"), action: { labelKey: "settings.doctor.a.start", run: restart } },
    );

    const takeOver = async () => {
      const r = await commands.oculpmWatcherTakeOver(projectId);
      if (r.status === "error") toast.destructive(t("settings.doctor.a.failed", { error: tError(r.error) }));
      await check();
    };
    out.push(
      !s
        ? { id: "lock", labelKey: "settings.doctor.lock", state: "off", value: unknown }
        : s.lock_state === "healthy"
          ? { id: "lock", labelKey: "settings.doctor.lock", state: "ok", value: t("settings.doctor.v.lockHealthy") }
          : s.lock_state === "held_by_other"
            ? { id: "lock", labelKey: "settings.doctor.lock", state: "warn", value: t("settings.doctor.v.lockHeld"), action: { labelKey: "settings.doctor.a.takeOver", run: takeOver } }
            : s.lock_state === "recovered"
              ? { id: "lock", labelKey: "settings.doctor.lock", state: "ok", value: t("settings.doctor.v.lockRecovered") }
              : { id: "lock", labelKey: "settings.doctor.lock", state: "off", value: t("settings.doctor.v.lockNone") },
    );

    const a = report.acp;
    const install = async () => {
      const r = await commands.acpInstallAdapter("claude");
      if (r.status === "ok") toast.info(t("settings.doctor.a.installDone"));
      else toast.destructive(t("settings.doctor.a.failed", { error: tError(r.error) }));
      await check();
    };
    out.push(
      !a
        ? { id: "acp", labelKey: "settings.doctor.acp", state: "off", value: unknown }
        : !a.node_ok
          ? { id: "acp", labelKey: "settings.doctor.acp", state: "danger", value: t("settings.doctor.v.acpNode", { min: a.node_min_major, node: a.node_version ?? "—" }) }
          : !a.adapter_ok
            ? { id: "acp", labelKey: "settings.doctor.acp", state: "warn", value: t("settings.doctor.v.acpAdapter", { expected: a.adapter_expected }), action: { labelKey: "settings.doctor.a.install", run: install } }
            : { id: "acp", labelKey: "settings.doctor.acp", state: "ok", value: t("settings.doctor.v.acpReady", { node: a.node_version ?? "?", adapter: a.adapter_version ?? "?" }) },
    );

    out.push(
      report.keys.length === 0
        ? { id: "keys", labelKey: "settings.doctor.keys", state: "warn", value: t("settings.doctor.v.keysNone"), action: { labelKey: "settings.doctor.a.keys", run: () => openSettings("llm") } }
        : { id: "keys", labelKey: "settings.doctor.keys", state: "ok", value: report.keys.join(" · ") },
    );

    const st = report.stats;
    out.push(
      indexing
        ? { id: "index", labelKey: "settings.doctor.index", state: "warn", value: t("settings.doctor.v.indexing") }
        : !st
          ? { id: "index", labelKey: "settings.doctor.index", state: "off", value: unknown }
          : st.chunks === 0
            ? { id: "index", labelKey: "settings.doctor.index", state: "warn", value: t("settings.doctor.v.indexNone"), action: { labelKey: "settings.doctor.a.index", run: () => requestReindex() } }
            : {
                id: "index",
                labelKey: "settings.doctor.index",
                state: "ok",
                value: t("settings.doctor.v.index", {
                  files: st.files,
                  chunks: st.chunks,
                  when: st.last_indexed_at != null ? (relativeTime(new Date(st.last_indexed_at * 1000).toISOString(), Date.now()) ?? "—") : "—",
                }),
              },
    );

    const sh = report.shell;
    out.push(
      !sh
        ? { id: "shell", labelKey: "settings.doctor.shell", state: "off", value: unknown }
        : sh.block_broken
          ? { id: "shell", labelKey: "settings.doctor.shell", state: "danger", value: t("settings.doctor.v.broken"), action: { labelKey: "settings.doctor.a.open", run: () => openSettings("oculpm") } }
          : sh.installed
            ? { id: "shell", labelKey: "settings.doctor.shell", state: "ok", value: t("settings.doctor.v.installed") }
            : { id: "shell", labelKey: "settings.doctor.shell", state: "off", value: t("settings.doctor.v.notInstalled"), action: { labelKey: "settings.doctor.a.open", run: () => openSettings("oculpm") } },
    );

    const hk = report.hooks;
    out.push(
      !hk
        ? { id: "hooks", labelKey: "settings.doctor.hooks", state: "off", value: unknown }
        : hk.installed
          ? { id: "hooks", labelKey: "settings.doctor.hooks", state: "ok", value: t("settings.doctor.v.installed") }
          : hk.partial
            ? { id: "hooks", labelKey: "settings.doctor.hooks", state: "warn", value: t("settings.doctor.v.partial"), action: { labelKey: "settings.doctor.a.open", run: () => openSettings("oculpm") } }
            : { id: "hooks", labelKey: "settings.doctor.hooks", state: "off", value: t("settings.doctor.v.notInstalled"), action: { labelKey: "settings.doctor.a.open", run: () => openSettings("oculpm") } },
    );

    const m = report.mcp;
    out.push(
      !m
        ? { id: "mcp", labelKey: "settings.doctor.mcp", state: "off", value: unknown }
        : m.registered && m.binary_found
          ? { id: "mcp", labelKey: "settings.doctor.mcp", state: "ok", value: t("settings.doctor.v.registered") }
          : m.registered
            ? { id: "mcp", labelKey: "settings.doctor.mcp", state: "danger", value: t("settings.doctor.v.binaryMissing"), action: { labelKey: "settings.doctor.a.open", run: () => openSettings("oculpm") } }
            : { id: "mcp", labelKey: "settings.doctor.mcp", state: "off", value: t("settings.doctor.v.notInstalled"), action: { labelKey: "settings.doctor.a.open", run: () => openSettings("oculpm") } },
    );
    // ── 자동화 (Phase 3 #doctor-automation) ─────────────────────────────────
    //
    // 다섯 줄이 "왜 안 도는가" 의 다섯 가지 답이다. 배경 모델이 맨 위인 이유:
    // 미설정이면 나머지 넷이 전부 참이어도 아무것도 돌지 않는다 (D2).
    const core = coreModelTarget(settings);
    out.push(
      core
        ? {
            id: "core-model",
            labelKey: "settings.doctor.coreModel",
            state: "ok",
            value: `${core.provider}:${core.model}`,
          }
        : {
            id: "core-model",
            labelKey: "settings.doctor.coreModel",
            state: "warn",
            value: t("settings.doctor.v.coreModelNone"),
            action: { labelKey: "settings.doctor.a.keys", run: () => openSettings("llm") },
          },
    );

    const au = report.automation;
    const openAutomation = { labelKey: "settings.doctor.a.open" as I18nKey, run: () => openSettings("automation") };
    out.push(
      !au
        ? { id: "schedules", labelKey: "settings.doctor.schedules", state: "off", value: unknown }
        : !au.schedules_on
          ? { id: "schedules", labelKey: "settings.doctor.schedules", state: "off", value: t("settings.doctor.v.switchOff"), action: openAutomation }
          : {
              id: "schedules",
              labelKey: "settings.doctor.schedules",
              state: au.active_schedules === 0 ? "warn" : "ok",
              // 다음 실행은 **미래**다 — `relativeTime` 은 과거 전용이라
              // (`Math.max(0, now - ms)`) 어떤 미래 시각도 "지금" 으로 접힌다.
              // 자동화 카드와 같은 절대 시각 포맷을 쓴다.
              value: t("settings.doctor.v.schedules", {
                n: au.active_schedules,
                when: formatAt(au.next_run_at) ?? "—",
              }),
            },
    );
    out.push(
      !au
        ? { id: "watchers", labelKey: "settings.doctor.watchers", state: "off", value: unknown }
        : !au.watchers_on
          ? { id: "watchers", labelKey: "settings.doctor.watchers", state: "off", value: t("settings.doctor.v.switchOff"), action: openAutomation }
          : {
              id: "watchers",
              labelKey: "settings.doctor.watchers",
              state: au.active_watchers === 0 ? "warn" : "ok",
              value: t("settings.doctor.v.watchers", {
                n: au.active_watchers,
                tiers: au.watcher_tiers.join(" · ") || "—",
              }),
            },
    );
    if (au && au.broken > 0) {
      // 켜 놓았는데 스펙이 깨진 정의 — 조용히 안 도는 것의 가장 흔한 정체다.
      out.push({
        id: "automation-broken",
        labelKey: "settings.doctor.automationBroken",
        state: "danger",
        value: t("settings.doctor.v.automationBroken", { n: au.broken }),
        action: openAutomation,
      });
    }
    out.push(
      !au
        ? { id: "budget", labelKey: "settings.doctor.budget", state: "off", value: unknown }
        : {
            id: "budget",
            labelKey: "settings.doctor.budget",
            state: au.used_today >= au.daily_run_budget ? "warn" : "ok",
            value: t("settings.doctor.v.budget", {
              used: au.used_today,
              budget: au.daily_run_budget,
            }),
          },
    );
    out.push(
      !au
        ? { id: "last-failure", labelKey: "settings.doctor.lastFailure", state: "off", value: unknown }
        : au.last_failure
          ? {
              id: "last-failure",
              labelKey: "settings.doctor.lastFailure",
              state: "warn",
              value: t("settings.doctor.v.lastFailure", {
                id: au.last_failure.automation_id,
                when: relativeTime(au.last_failure.started_at, Date.now()) ?? "—",
                note: au.last_failure.note ?? "—",
              }),
              action: openAutomation,
            }
          : { id: "last-failure", labelKey: "settings.doctor.lastFailure", state: "ok", value: t("settings.doctor.v.noFailure") },
    );

    return out;
  }, [report, projectId, indexing, t, check, settings]);

  return (
    <Section title={t("settings.doctor.title")} description={t("settings.doctor.desc")}>
      {projectId == null ? (
        <div className="text-[11px] text-muted-foreground">{t("settings.doctor.noProject")}</div>
      ) : (
        <>
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60" aria-busy={checking}>
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className={`h-2 w-2 rounded-full flex-none ${DOT[row.state]}`} aria-hidden="true" />
                <span className="w-32 flex-none font-medium text-foreground">{t(row.labelKey)}</span>
                <span className="flex-1 min-w-0 truncate text-muted-foreground" title={row.value}>
                  {row.value}
                </span>
                {row.action ? (
                  <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => void row.action!.run()}>
                    {t(row.action.labelKey)}
                  </Button>
                ) : null}
              </li>
            ))}
            {rows.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">{t("settings.doctor.checking")}</li>
            ) : null}
          </ul>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => void check()} disabled={checking} variant="outline" size="sm">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${checking ? "animate-spin" : ""}`} />
              {t("settings.doctor.refresh")}
            </Button>
          </div>

          <div className="space-y-1 pt-2">
            <div className="flex items-center gap-2">
              <Stethoscope className="w-3.5 h-3.5 text-muted-foreground" />
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex-1">
                {t("settings.doctor.warnings")}
              </div>
              {warnings.length > 0 ? (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => clearIntegrityLog(projectId)}>
                  {t("settings.doctor.clear")}
                </Button>
              ) : null}
            </div>
            {warnings.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">{t("settings.doctor.warningsEmpty")}</div>
            ) : (
              <ul className="text-[11px] font-mono space-y-1">
                {warnings.map((w) => (
                  <li key={w.id} className="flex gap-3">
                    <span className="text-muted-foreground tabular-nums flex-none">
                      {relativeTime(new Date(w.at).toISOString(), Date.now()) ?? ""}
                    </span>
                    <span className="flex-none text-(--warn-text)">[{w.kind}]</span>
                    <span className="truncate" title={`${w.path}\n${w.message}`}>
                      {w.path} — {w.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Section>
  );
}
