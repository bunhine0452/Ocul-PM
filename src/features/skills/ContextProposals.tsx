// AD-5/AD-6 — 자기정리 제안 3종 (docs/agent-discipline/00-master-plan.md D2 존 3 · D4).
//
// 만든 뒤에도 살아 있음을 계속 증명하게 하는 쪽 절반이다. 세 카드 모두
// **결정적 판정 → 사람의 승인 → 그때서야 파일**이라는 같은 순서를 지킨다.
//
//   범위 교정 — 이 프로젝트가 안 쓰는 스택의 규칙이 넓은 glob 으로 매 세션
//               딸려온다. 처방은 그 스택의 표준 확장자로 `paths` 축소.
//               **전역 규칙은 사용자 파일**이라 쓰기는 백업 경로 하나뿐이다.
//   정리     — 이 프로젝트에서 절대 안 걸리거나(매칭 0) 30일 발동 0회인 규칙.
//   트리거 교정 — 안 걸리는 스킬의 영문 description 재작성 초안(과금, 옵인).
//
// "무시" 는 세션-로컬 숨김이다 — 아무 파일도 건드리지 않는다.
import { useMemo, useState } from "react";

import { AppDialog } from "@/components/ui/AppDialog";
import { OculSpinner } from "@/components/OculSpinner";
import { Scissors, PenLine, Trash2, X } from "@/components/Icons";
import { rulesApi, skillsApi } from "@/api/claudeSurface";
import { toAppError } from "@/api/invoke";
import { toast } from "@/lib/toast";
import { tError } from "@/i18n/errors";
import { t, useT } from "@/i18n";
import { resolveLlmTarget } from "@/lib/llmTarget";
import { useConfirm } from "@/hooks/useConfirm";
import { setRulePaths } from "./rulesModel";
import {
  kb,
  type CleanupProposal,
  type ContextItem,
  type DormantSkill,
  type ScopeProposal,
} from "./contextModel";
import type { SkillScope, SkillTriggerDraft } from "@/lib/bindings";

/** 0회 이유 → i18n 키. `genuine` 은 이 절에 오지 않는다 (위 카드가 맡는다). */
const DORMANT_KEY = {
  "precondition-missing": "ctx.prop.preconditionBadge",
  suppressed: "ctx.prop.suppressedBadge",
  "too-new": "ctx.prop.tooNewBadge",
  genuine: "ctx.prop.triggerTitle",
} as const;

interface ContextProposalsProps {
  projectId: number;
  scope: ScopeProposal[];
  cleanup: CleanupProposal[];
  trigger: ContextItem[];
  /** 0회 스킬 전체(이유별). `genuine` 이 아닌 것은 카드 대신 사실만 적는다. */
  dormant: DormantSkill[];
  days: number;
  /** 파일이 바뀌었다 — 목록·감사를 다시 읽는다. */
  onChanged: () => void;
}

export function ContextProposals({
  projectId,
  scope,
  cleanup,
  trigger,
  dormant,
  days,
  onChanged,
}: ContextProposalsProps) {
  useT();
  const { confirm, confirmDialog } = useConfirm();
  /** 세션-로컬 숨김 — 파일에는 아무것도 쓰지 않는다 (승격 패널과 같은 규약). */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ item: ContextItem; draft: SkillTriggerDraft } | null>(null);

  const hide = (key: string) => setDismissed((prev) => new Set(prev).add(key));
  const visible = <T,>(list: T[], key: (v: T) => string) =>
    list.filter((v) => !dismissed.has(key(v)));

  const scopeShown = useMemo(() => visible(scope, (p) => `scope:${p.item.id}`), [scope, dismissed]);
  const cleanupShown = useMemo(
    () => visible(cleanup, (p) => `cleanup:${p.item.id}`),
    [cleanup, dismissed],
  );
  // 설명 고쳐쓰기가 답이 아닌 0회들 — 이유를 밝히기만 한다.
  const explained = useMemo(
    () => dormant.filter((d) => d.reason !== "genuine"),
    [dormant],
  );
  const triggerShown = useMemo(
    () => visible(trigger, (i) => `trigger:${i.id}`),
    [trigger, dismissed],
  );

  // ── 처방 ────────────────────────────────────────────────────────────────

  /** 범위 좁히기 — 원문을 읽어 `paths` 행만 갈고, 백업 경로로 저장한다. */
  const narrow = async (p: ScopeProposal) => {
    const rule = p.item.rule;
    if (!rule || busy) return;
    setBusy(p.item.id);
    try {
      const detail = await rulesApi.read(projectId, rule.scope, rule.rel_path);
      const next = setRulePaths(detail.content, p.suggestedGlobs);
      const outcome = await rulesApi.saveWithBackup(projectId, rule.scope, rule.rel_path, next);
      toast.info(t("ctx.prop.narrowed", { name: p.item.name, backup: outcome.backup_path }));
      hide(`scope:${p.item.id}`);
      onChanged();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(null);
    }
  };

  const removeRule = async (p: CleanupProposal) => {
    const rule = p.item.rule;
    if (!rule || busy) return;
    const ok = await confirm({
      title: t("rules.deleteTitle"),
      message: t("ctx.prop.deleteBody", { path: p.item.path }),
      danger: true,
    });
    if (!ok) return;
    setBusy(p.item.id);
    try {
      await rulesApi.remove(projectId, rule.scope, rule.rel_path);
      toast.info(t("rules.ruleDeleted", { name: p.item.name }));
      hide(`cleanup:${p.item.id}`);
      onChanged();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(null);
    }
  };

  const disableSkill = async (item: ContextItem) => {
    if (!item.skill || busy) return;
    setBusy(item.id);
    try {
      await skillsApi.setEnabled(projectId, item.scope as SkillScope, item.skill.dir_name, false);
      toast.info(t("sk.disabled", { name: item.name }));
      hide(`trigger:${item.id}`);
      onChanged();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(null);
    }
  };

  /** description 재작성 초안 — 과금 호출. 파일은 승인 후에만. */
  const rewrite = async (item: ContextItem) => {
    if (!item.skill || busy) return;
    const target = await resolveLlmTarget();
    if (!target) {
      toast.warning(t("promo.needProvider"));
      return;
    }
    setBusy(item.id);
    try {
      const next = await skillsApi.triggerRewrite(
        projectId,
        item.scope as SkillScope,
        item.skill.dir_name,
        target.provider,
        target.model,
      );
      setDraft({ item, draft: next });
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(null);
    }
  };

  const applyRewrite = async () => {
    if (!draft?.item.skill || busy) return;
    setBusy(draft.item.id);
    try {
      await skillsApi.save(
        projectId,
        draft.item.scope as SkillScope,
        draft.item.skill.dir_name,
        draft.draft.content,
        false,
      );
      toast.info(t("ctx.prop.triggerSaved", { name: draft.item.name }));
      hide(`trigger:${draft.item.id}`);
      setDraft(null);
      onChanged();
    } catch (err) {
      toast.destructive(tError(toAppError(err)));
    } finally {
      setBusy(null);
    }
  };

  if (scopeShown.length + cleanupShown.length + triggerShown.length === 0) return null;

  return (
    <>
      {scopeShown.length > 0 ? (
        <div className="ctx-card" id="ctx-scope">
          <div className="ctx-card-head">
            <Scissors size={14} />
            <h4>{t("ctx.prop.scopeTitle")}</h4>
            <span className="ctx-zone-sub">{t("ctx.prop.scopeSub")}</span>
          </div>
          <ul className="ctx-prop-list">
            {scopeShown.map((p) => (
              <li key={p.item.id}>
                <div className="ctx-prop-meta">
                  <span className="ctx-prop-name">{p.item.name}</span>
                  <span className="sk-chip off">{p.family}</span>
                  {p.item.scope === "global" ? (
                    <span className="sk-chip">{t("rules.scope.global")}</span>
                  ) : null}
                  <span className="ctx-prop-cost">
                    {p.injections > 0 ? t("ctx.prop.injected", { n: p.injections, d: days }) : ""}
                    {p.wastedPerSession > 0
                      ? ` · ${t("ctx.prop.wasted", { kb: kb(p.wastedPerSession) })}`
                      : ""}
                  </span>
                  <span className="ctx-prop-why">
                    {t("ctx.prop.scopeWhy", {
                      family: p.family,
                      detected: p.detected.join("·") || "—",
                    })}
                  </span>
                  <span className="ctx-prop-globs">
                    {p.currentGlobs.map((g) => (
                      <code key={g}>{g}</code>
                    ))}
                    {p.suggestedGlobs.length > 0 ? (
                      <>
                        <span aria-hidden="true">→</span>
                        {p.suggestedGlobs.map((g) => (
                          <code key={g} className="next">
                            {g}
                          </code>
                        ))}
                      </>
                    ) : null}
                  </span>
                </div>
                <div className="ctx-prop-actions">
                  {p.suggestedGlobs.length > 0 ? (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy != null}
                      title={t("ctx.prop.narrowTitle")}
                      onClick={() => void narrow(p)}
                    >
                      {busy === p.item.id ? <OculSpinner size={13} /> : <Scissors size={13} />}{" "}
                      {t("ctx.prop.narrow")}
                    </button>
                  ) : (
                    <span className="ctx-prop-note">{t("ctx.prop.noNarrow")}</span>
                  )}
                  <DismissButton name={p.item.name} onClick={() => hide(`scope:${p.item.id}`)} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {cleanupShown.length > 0 ? (
        <div className="ctx-card" id="ctx-cleanup">
          <div className="ctx-card-head">
            <Trash2 size={14} />
            <h4>{t("ctx.prop.cleanupTitle")}</h4>
            <span className="ctx-zone-sub">{t("ctx.prop.cleanupSub", { d: days })}</span>
          </div>
          <ul className="ctx-prop-list">
            {cleanupShown.map((p) => (
              <li key={p.item.id}>
                <div className="ctx-prop-meta">
                  <span className="ctx-prop-name">{p.item.name}</span>
                  {p.item.scope === "global" ? (
                    <span className="sk-chip">{t("rules.scope.global")}</span>
                  ) : null}
                  <span className="ctx-prop-why">
                    {p.reason === "never-matches"
                      ? t("ctx.prop.neverMatches")
                      : p.reason === "negated"
                        ? t("ctx.prop.negatedWhy", { kb: kb(p.item.bytes) })
                        : t("ctx.prop.dormantWhy", { d: days })}
                  </span>
                  {p.deadGlobs.length > 0 ? (
                    <span className="ctx-prop-globs">
                      {p.deadGlobs.map((g) => (
                        <code key={g}>{g}</code>
                      ))}
                    </span>
                  ) : null}
                  {/* 부정은 휴리스틱이다 — 근거 문장을 그대로 보여 주고 사람이
                      판정하게 한다. 발췌 없이 "부정됨" 만 말하면 믿을 수 없다. */}
                  {p.negation ? (
                    <span className="ctx-prop-quote" title={p.negation.citedIn}>
                      <code>{p.negation.citedIn}</code> “{p.negation.excerpt}”
                    </span>
                  ) : null}
                </div>
                <div className="ctx-prop-actions">
                  <button
                    type="button"
                    className="btn danger sm"
                    disabled={busy != null}
                    onClick={() => void removeRule(p)}
                  >
                    <Trash2 size={13} /> {t("common.delete")}
                  </button>
                  <DismissButton name={p.item.name} onClick={() => hide(`cleanup:${p.item.id}`)} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {triggerShown.length > 0 ? (
        <div className="ctx-card" id="ctx-trigger">
          <div className="ctx-card-head">
            <PenLine size={14} />
            <h4>{t("ctx.prop.triggerTitle")}</h4>
            <span className="ctx-zone-sub">{t("ctx.prop.triggerSub", { d: days })}</span>
          </div>
          <ul className="ctx-prop-list">
            {triggerShown.map((item) => (
              <li key={item.id}>
                <div className="ctx-prop-meta">
                  <span className="ctx-prop-name">{item.name}</span>
                  {item.scope === "global" ? (
                    <span className="sk-chip">{t("rules.scope.global")}</span>
                  ) : null}
                  <span className="ctx-prop-why">
                    {item.sub ? item.sub : t("ctx.prop.noDescription")}
                  </span>
                </div>
                <div className="ctx-prop-actions">
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy != null}
                    title={t("ctx.prop.rewriteTitle")}
                    onClick={() => void rewrite(item)}
                  >
                    {busy === item.id ? <OculSpinner size={13} /> : <PenLine size={13} />}{" "}
                    {t("ctx.prop.rewrite")}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busy != null}
                    title={t("sk.disableTitle")}
                    onClick={() => void disableSkill(item)}
                  >
                    {t("sk.disable")}
                  </button>
                  <DismissButton name={item.name} onClick={() => hide(`trigger:${item.id}`)} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 「0회」 는 결함이 아니다 — 네 가지 상태다. 설명을 고쳐 쓰면 오히려
          나빠지는 셋(선행조건 부재·억제됨·너무 새것)은 카드가 아니라 사실로
          적는다. 제안은 위 카드의 `genuine` 만 받는다. */}
      {explained.length > 0 ? (
        <div className="ctx-card" id="ctx-dormant-explained">
          <div className="ctx-card-head">
            <PenLine size={14} />
            <h4>{t("ctx.prop.explainedTitle")}</h4>
            <span className="ctx-zone-sub">{t("ctx.prop.explainedSub")}</span>
          </div>
          <ul className="ctx-prop-list">
            {explained.map((d) => (
              <li key={d.item.id}>
                <div className="ctx-prop-meta">
                  <span className="ctx-prop-name">{d.item.name}</span>
                  {d.item.scope === "global" ? (
                    <span className="sk-chip">{t("rules.scope.global")}</span>
                  ) : null}
                  <span className="sk-chip dormant">{t(DORMANT_KEY[d.reason])}</span>
                  <span className="ctx-prop-why">
                    {d.reason === "precondition-missing"
                      ? t("ctx.prop.preconditionWhy", { files: d.missingFiles.join(", ") })
                      : d.reason === "suppressed"
                        ? t("ctx.prop.suppressedWhy")
                        : t("ctx.prop.tooNewWhy", { d: days })}
                  </span>
                  {d.suppression ? (
                    <span className="ctx-prop-quote" title={d.suppression.citedIn}>
                      <code>{d.suppression.citedIn}</code> “{d.suppression.excerpt}”
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 재작성 초안 — 닫기(거절)는 아무 파일도 바꾸지 않는다. */}
      <AppDialog
        open={draft != null}
        onClose={() => setDraft(null)}
        label={t("ctx.prop.draftLabel")}
        width={620}
      >
        {draft ? (
          <>
            <div className="sk-modal-head">
              <PenLine size={15} /> {draft.item.name}
              <span className="ctx-zone-sub">{t("promo.aiDraftNote")}</span>
            </div>
            <div className="ctx-draft">
              <div className="ctx-draft-row">
                <span className="ctx-draft-label">{t("ctx.prop.before")}</span>
                <p>{draft.draft.current || t("ctx.prop.noDescription")}</p>
              </div>
              <div className="ctx-draft-row next">
                <span className="ctx-draft-label">{t("ctx.prop.after")}</span>
                <p>{draft.draft.proposed}</p>
              </div>
              {draft.draft.rationale ? (
                <p className="ctx-draft-why">{draft.draft.rationale}</p>
              ) : null}
            </div>
            <div className="sk-modal-foot">
              <button type="button" className="btn ghost sm" onClick={() => setDraft(null)}>
                {t("promo.reject")}
              </button>
              <button
                type="button"
                className="btn primary sm"
                disabled={busy != null}
                onClick={() => void applyRewrite()}
              >
                {t("ctx.prop.apply")}
              </button>
            </div>
          </>
        ) : null}
      </AppDialog>
      {confirmDialog}
    </>
  );
}

function DismissButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn ghost sm"
      aria-label={t("promo.hideAria", { name })}
      title={t("promo.hideHint")}
      onClick={onClick}
    >
      <X size={13} />
    </button>
  );
}
