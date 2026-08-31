// 설정 → 자동화 탭 (Osaurus 라운드 Phase 1).
//
// **새 화면을 만들지 않는다** — 자동화는 "설정에 가까운 관리면" 이라 12개 화면
// 목록을 늘리는 대신 설정 탭으로 들어온다 (설계 §1.3).
//
// 화면이 답해야 하는 것 넷: (1) 지금 돌게 되어 있는가 (2) 언제 돌고 마지막엔
// 어땠는가 (3) 왜 안 돌았는가 (4) 무엇을 시킬 수 있는가(씨앗).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, MoreHorizontal, Play, Trash2 } from "@/components/Icons";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toAppError } from "@/api/invoke";
import { automationApi } from "@/api/automation";
import { oculpmApi } from "@/api/oculpm";
import { useConfirm } from "@/hooks/useConfirm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { coreModelTarget } from "@/lib/settings";
import { openSettings } from "@/lib/settingsNav";
import { toast } from "@/lib/toast";
import type {
  AutomationConfig,
  AutomationDef,
  AutomationRunDto,
  AutomationSummary,
  OculpmConfig,
} from "@/lib/bindings";
import { Section, Toggle } from "../tabs/ui";
import { AutomationEditor } from "./AutomationEditor";
import { AutomationHistory } from "./AutomationHistory";
import {
  blankDefinition,
  cardState,
  describeAutomation,
  formatAt,
  sortSummaries,
} from "./automationModel";
import { AutomationTroubleshooting } from "./AutomationTroubleshooting";

/**
 * `[automation]` 이 없는 옛 `config.toml` 은 이 값으로 파싱된다 (백엔드
 * `AutomationConfig::default` 와 같은 값). 스위치를 처음 켤 때 이 껍데기 위에
 * 얹어야 예산이 0 으로 떨어지지 않는다.
 */
const AUTOMATION_DEFAULT: AutomationConfig = {
  schedules: false,
  watchers: false,
  daily_run_budget: 20,
};

type Pane =
  | { kind: "none" }
  | { kind: "edit"; def: AutomationDef; isNew: boolean }
  | { kind: "history"; automationId: string };

export function AutomationTab() {
  const { t } = useT();
  const { state } = useWorkspace();
  const { settings } = useSettings();
  const { confirm, confirmDialog } = useConfirm();
  const projectId = state.currentProjectId;

  const [items, setItems] = useState<AutomationSummary[]>([]);
  const [seeds, setSeeds] = useState<AutomationDef[]>([]);
  const [config, setConfig] = useState<OculpmConfig | null>(null);
  const [runs, setRuns] = useState<AutomationRunDto[]>([]);
  const [pane, setPane] = useState<Pane>({ kind: "none" });
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const coreModel = coreModelTarget(settings);

  const refresh = useCallback(async () => {
    if (projectId == null) return;
    try {
      const [list, seedList, cfg] = await Promise.all([
        automationApi.list(projectId),
        automationApi.seeds(projectId),
        oculpmApi.getConfig(projectId),
      ]);
      setItems(sortSummaries(list));
      setSeeds(seedList);
      setConfig(cfg);
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pane.kind !== "history" || projectId == null) return;
    let cancelled = false;
    void automationApi
      .runs(projectId, pane.automationId, 50)
      .then((r) => !cancelled && setRuns(r))
      .catch((e) => !cancelled && toast.destructive(tError(toAppError(e))));
    return () => {
      cancelled = true;
    };
  }, [pane, projectId]);

  const guard = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const setSwitch = async (key: "schedules" | "watchers", value: boolean) => {
    if (projectId == null || !config) return;
    const next: OculpmConfig = {
      ...config,
      automation: { ...(config.automation ?? AUTOMATION_DEFAULT), [key]: value },
    };
    const ok = await guard(() => oculpmApi.setConfig(projectId, next));
    if (ok !== null) {
      setConfig(next);
      void refresh();
    }
  };

  const save = async (def: AutomationDef) => {
    if (projectId == null) return;
    const saved = await guard(() => automationApi.save(projectId, def));
    if (saved) {
      setPane({ kind: "none" });
      void refresh();
    }
  };

  const toggleEnabled = async (s: AutomationSummary) => {
    if (projectId == null) return;
    const ok = await guard(() =>
      automationApi.setEnabled(projectId, s.def.kind, s.def.id, !s.def.enabled)
    );
    if (ok) void refresh();
  };

  const remove = async (s: AutomationSummary) => {
    if (projectId == null) return;
    const yes = await confirm({
      title: t("automation.delete.title", { name: s.def.title }),
      message: t("automation.delete.body"),
      danger: true,
    });
    if (!yes) return;
    const ok = await guard(() => automationApi.remove(projectId, s.def.kind, s.def.id));
    if (ok !== null) {
      setPane({ kind: "none" });
      void refresh();
    }
  };

  const runNow = async (s: AutomationSummary) => {
    if (projectId == null) return;
    const outcome = await guard(() => automationApi.runNow(projectId, s.def.kind, s.def.id));
    if (!outcome) return;
    // 결말을 그대로 말한다 — "실행했습니다" 라고만 하면 스킵·드롭이 성공처럼 보인다.
    const msg = t(`automation.runOutcome.${outcome.status}` as never);
    if (outcome.status === "ran") toast.info(msg);
    else toast.warning(outcome.reason ? `${msg} — ${outcome.reason}` : msg);
    void refresh();
  };

  const addSeed = async (seedId: string) => {
    if (projectId == null) return;
    const created = await guard(() => automationApi.createSeed(projectId, seedId));
    if (created) void refresh();
  };

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  if (projectId == null) {
    return <p className="empty-hint">{t("automation.noProject")}</p>;
  }

  return (
    <>
      {/* Core Model 게이트 (D2) — 배경 모델이 없으면 자동화는 조용히 건너뛴다.
          그 사실을 화면 맨 위에서 말하고, 고치러 갈 문을 붙인다. */}
      {!coreModel && (
        <div className="rounded-md border border-border bg-accent/20 px-3 py-2 mb-4" role="status">
          <p className="text-xs text-foreground">{t("automation.gate.title")}</p>
          <button
            className="text-[11px] text-primary hover:underline cursor-pointer mt-1"
            onClick={() => openSettings("llm")}
          >
            {t("automation.gate.action")}
          </button>
        </div>
      )}

      <Section title={t("automation.switches.title")} description={t("automation.switches.desc")}>
        <Toggle
          checked={config?.automation?.schedules ?? false}
          onChange={(v) => void setSwitch("schedules", v)}
          label={t("automation.switches.schedules")}
        />
        {/* Phase 2 — 워처 축. 스케줄과 **별개 스위치**다: 시계는 예측 가능하지만
            감시는 사용자의 작업량에 비례해 돌기 때문에 따로 끌 수 있어야 한다. */}
        <Toggle
          checked={config?.automation?.watchers ?? false}
          onChange={(v) => void setSwitch("watchers", v)}
          label={t("automation.switches.watchers")}
        />
        <p className="text-[11px] text-muted-foreground">
          {t("automation.switches.budget", {
            n: String(config?.automation?.daily_run_budget ?? AUTOMATION_DEFAULT.daily_run_budget),
          })}
        </p>
      </Section>

      <Section title={t("automation.list.title")} description={t("automation.list.desc")}>
        <div className="flex justify-end gap-2">
          <button
            className="btn ghost sm"
            onClick={() =>
              setPane({ kind: "edit", def: blankDefinition(today, "watcher"), isNew: true })
            }
          >
            {t("automation.list.newWatcher")}
          </button>
          <button
            className="btn sm"
            onClick={() => setPane({ kind: "edit", def: blankDefinition(today), isNew: true })}
          >
            {t("automation.list.new")}
          </button>
        </div>

        {loaded && items.length === 0 && (
          <p className="empty-hint">{t("automation.list.empty")}</p>
        )}

        <ul className="space-y-2">
          {items.map((s) => {
            const st = cardState(s);
            const next = formatAt(s.next_run_at);
            const last = formatAt(s.last_run_at);
            return (
              <li key={`${s.def.kind}:${s.def.id}`} className="card card-pad">
                <div className="stat-top">
                  <Clock size={14} color="var(--accent-text)" />
                  <strong>{s.def.title}</strong>
                  <span className={st === "broken" ? "chip warn" : "chip"}>
                    {t(`automation.state.${st}` as never)}
                  </span>
                  <button
                    className="iconbtn right"
                    aria-label={t("automation.card.menu")}
                    onClick={() => setMenuFor(menuFor === s.def.id ? null : s.def.id)}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>

                <p className="text-[11px] text-muted-foreground mt-1">
                  {describeAutomation(s.def)}
                  {next ? ` · ${t("automation.card.next", { at: next })}` : ""}
                </p>
                {last && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("automation.card.last", {
                      at: last,
                      status: t(`automation.status.${s.last_status ?? "ok"}` as never),
                    })}
                  </p>
                )}
                {s.spec_error && (
                  <p className="text-[11px] text-destructive mt-1">
                    {tError({ code: s.spec_error, detail: null })}
                  </p>
                )}
                {s.warnings.map((w) => (
                  <p key={w} className="text-[11px] text-muted-foreground/80 mt-1">
                    {w}
                  </p>
                ))}

                {menuFor === s.def.id && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => setPane({ kind: "edit", def: s.def, isNew: false })}
                    >
                      {t("automation.card.edit")}
                    </button>
                    <button className="btn ghost sm" disabled={busy} onClick={() => void runNow(s)}>
                      <Play size={12} /> {t("automation.card.runNow")}
                    </button>
                    <button
                      className="btn ghost sm"
                      onClick={() => setPane({ kind: "history", automationId: s.def.id })}
                    >
                      {t("automation.card.history")}
                    </button>
                    <button
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => void toggleEnabled(s)}
                    >
                      {s.def.enabled ? t("automation.card.pause") : t("automation.card.resume")}
                    </button>
                    <button
                      className="btn ghost sm danger"
                      disabled={busy}
                      onClick={() => void remove(s)}
                    >
                      <Trash2 size={12} /> {t("common.delete")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* 씨앗 — 빈 화면 대신 "이걸로 시작". 만들어도 **꺼진 채로** 생긴다. */}
        {seeds.length > 0 && (
          <div className="pt-2">
            <p className="text-[11px] text-muted-foreground mb-2">{t("automation.seeds.title")}</p>
            <div className="flex flex-wrap gap-2">
              {seeds.map((seed) => (
                <button
                  key={seed.id}
                  className="btn ghost sm"
                  disabled={busy}
                  onClick={() => void addSeed(seed.id)}
                >
                  + {seed.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      {pane.kind === "edit" && (
        <Section
          title={pane.isNew ? t("automation.editor.newTitle") : t("automation.editor.editTitle")}
        >
          <AutomationEditor
            key={`${pane.def.kind}:${pane.def.id}:${pane.isNew}`}
            value={pane.def}
            isNew={pane.isNew}
            busy={busy}
            onCancel={() => setPane({ kind: "none" })}
            onSave={(d) => void save(d)}
          />
        </Section>
      )}

      {/* 문제 해결 3종 — 에디터·진단과 **같은 컴포넌트**라 말이 갈라지지 않는다. */}
      <Section title={t("automation.trouble.title")}>
        <AutomationTroubleshooting compact />
      </Section>

      {pane.kind === "history" && (
        <Section title={t("automation.history.title", { name: pane.automationId })}>
          <AutomationHistory runs={runs} loading={false} />
          <button className="btn ghost sm" onClick={() => setPane({ kind: "none" })}>
            {t("common.close")}
          </button>
        </Section>
      )}

      {confirmDialog}
    </>
  );
}
