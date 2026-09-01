/**
 * 설정 → 컨텍스트 (Osaurus 라운드 Phase 5 `#context-tab`).
 *
 * ocul-pm 은 데이터는 전부 갖고 있는데 **그것이 컨텍스트에 어떻게 쓰이는지 볼
 * 창**이 없었다. 이 탭이 그 창이다 — 무엇이 항상 가는지, 이번 대화가 받는
 * 매니페스트가 무엇인지, 회상 후보의 관련도가 어떤지, 예산을 얼마나 썼는지.
 *
 * Osaurus 의 `Management → Memory` 를 기록기 맥락으로 옮긴 것이다.
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, Trash2 } from "@/components/Icons";
import { contextApi } from "@/api/context";
import { toAppError } from "@/api/invoke";
import { useSettings } from "@/contexts/SettingsContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useConfirm } from "@/hooks/useConfirm";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toast } from "@/lib/toast";
import type { RecallStat } from "@/lib/bindings";
import { buildManifest } from "@/features/chat/manifest";
import { RECALL_BUDGET_TOKENS } from "@/features/chat/recallGate";
import { useRecallUsage } from "@/features/chat/recallUsage";
import { Section, Field } from "./ui";

export function ContextTab() {
  const { t } = useT();
  const { state } = useWorkspace();
  const projectId = state.currentProjectId;
  const { settings, set } = useSettings();
  const { confirm, confirmDialog } = useConfirm();
  const usage = useRecallUsage();

  const [instructions, setInstructions] = useState("");
  const [manifest, setManifest] = useState<string>("");
  const [stats, setStats] = useState<RecallStat[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (projectId == null) return;
    try {
      const [text, top, built] = await Promise.all([
        contextApi.instructionsGet(projectId),
        contextApi.top(projectId, 20),
        buildManifest(projectId),
      ]);
      setInstructions(text);
      setStats(top);
      setManifest(built.text);
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveInstructions = async (next: string) => {
    if (projectId == null) return;
    setInstructions(next);
    try {
      await contextApi.instructionsSet(projectId, next);
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    }
  };

  const forget = async (stat: RecallStat) => {
    if (projectId == null) return;
    setBusy(true);
    try {
      await contextApi.forget(projectId, stat.kind, stat.ref_);
      setStats((prev) => prev.filter((s) => !(s.kind === stat.kind && s.ref_ === stat.ref_)));
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  const resetAll = async () => {
    if (projectId == null) return;
    const ok = await confirm({
      title: t("ctx.reset.title"),
      message: t("ctx.reset.body"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const removed = await contextApi.reset(projectId);
      setStats([]);
      toast.info(t("ctx.reset.done", { n: removed }));
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  const copyManifest = () => {
    void navigator.clipboard?.writeText(manifest).then(
      () => toast.info(t("ctx.manifest.copied")),
      () => {},
    );
  };

  return (
    <>
      {/* ── 항상 가는 것 ─────────────────────────────────────────────────── */}
      <Section title={t("ctx.always.title")} description={t("ctx.always.desc")}>
        <Field label={t("ctx.always.global")} hint={t("ctx.always.globalHint")}>
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => void set("systemPrompt", e.currentTarget.value)}
            rows={4}
            placeholder={t("ctx.always.placeholder")}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm text-foreground font-mono"
          />
        </Field>
        <Field label={t("ctx.always.project")} hint={t("ctx.always.projectHint")}>
          <textarea
            value={instructions}
            disabled={projectId == null}
            onChange={(e) => void saveInstructions(e.currentTarget.value)}
            rows={4}
            placeholder={t("ctx.always.placeholder")}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm text-foreground font-mono disabled:opacity-50"
          />
        </Field>
      </Section>

      {/* ── 매니페스트 미리보기 ──────────────────────────────────────────── */}
      <Section title={t("ctx.manifest.title")} description={t("ctx.manifest.desc")}>
        <div className="flex justify-end">
          <button type="button" className="btn ghost sm" onClick={copyManifest} disabled={!manifest}>
            <Copy size={12} /> {t("ctx.manifest.copy")}
          </button>
        </div>
        <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-[color:var(--bg-inset)] p-3 text-[11px] font-mono whitespace-pre-wrap text-foreground">
          {manifest || t("ctx.manifest.empty")}
        </pre>
      </Section>

      {/* ── 예산 ─────────────────────────────────────────────────────────── */}
      <Section title={t("ctxTab.budget.title")} description={t("ctx.budget.desc")}>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-[color:var(--bg-inset)] overflow-hidden">
            <div
              className="h-full bg-[color:var(--accent)]"
              style={{ width: `${Math.min(100, (usage.tokens / RECALL_BUDGET_TOKENS) * 100)}%` }}
            />
          </div>
          <span className="text-xs font-mono tabular-nums text-foreground">
            {usage.tokens} / {RECALL_BUDGET_TOKENS}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("ctx.budget.signal", { signal: t(`ctx.signal.${usage.signal}` as never) })}
          {usage.dropped > 0 ? ` · ${t("ctx.budget.dropped", { n: usage.dropped })}` : ""}
        </p>
      </Section>

      {/* ── 회상 후보 ────────────────────────────────────────────────────── */}
      <Section title={t("ctx.recall.title")} description={t("ctx.recall.desc")}>
        {stats.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("ctx.recall.empty")}</p>
        ) : (
          <ul className="space-y-1.5 list-none p-0 m-0">
            {stats.map((stat) => (
              <li key={`${stat.kind}:${stat.ref_}`} className="flex items-center gap-2">
                <span className="chip flex-none">{stat.kind}</span>
                <span className="text-xs truncate flex-1 text-foreground" title={stat.ref_}>
                  {stat.ref_}
                </span>
                <span className="h-1.5 w-20 flex-none rounded-full bg-[color:var(--bg-inset)] overflow-hidden">
                  <span
                    className="block h-full bg-[color:var(--accent)]"
                    style={{ width: `${Math.round((stat.score ?? 0) * 100)}%` }}
                  />
                </span>
                <span className="text-[11px] font-mono tabular-nums text-muted-foreground w-8 text-right">
                  {stat.use_count}
                </span>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={t("ctx.recall.forget", { ref: stat.ref_ })}
                  title={t("ctx.recall.forgetShort")}
                  disabled={busy}
                  onClick={() => void forget(stat)}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── 위험 구역 ────────────────────────────────────────────────────── */}
      <Section title={t("ctx.danger.title")} description={t("ctx.danger.desc")}>
        <button
          type="button"
          className="btn ghost sm danger"
          disabled={busy || projectId == null}
          onClick={() => void resetAll()}
        >
          <Trash2 size={12} /> {t("ctx.reset.action")}
        </button>
      </Section>

      {confirmDialog}
    </>
  );
}
