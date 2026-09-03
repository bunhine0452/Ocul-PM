// AD-3 존 1 — 컨텍스트 예산 바 (docs/agent-discipline/00-master-plan.md D2).
//
// 이 프로젝트에서 세션마다 에이전트에게 **얼마가 들어가는지**를 한 줄로 말한다.
// 2026-08-29 실측 기준선이 90KB(≈22K 토큰)였고 그중 상당수가 이 스택과 무관한
// 규칙이었다 — 그런데 그걸 보여 주는 화면이 없었다. 안 보이는 비용은 아무도
// 줄이지 않는다.
//
// 조각들의 출처가 서로 다르다는 것을 숨기지 않는다: 항상-로드는 디스크에서
// 확정, 조건부는 transcript **실측**, 스킬과 에이전트·커맨드는 광고
// (이름+description) 비용이다.
//
// 2026-09-03 에 표면 조각이 뒤늦게 붙었다 — 그 전까지 예산은 에이전트 67개·
// 커맨드 94개의 설명 약 30KB 를 세지 않아 실제보다 작게 보고하고 있었다.
import { PieChart } from "@/components/Icons";
import { t, useT } from "@/i18n";
import {
  BUDGET_BASELINE_BYTES,
  BUDGET_TARGET_BYTES,
  kb,
  type ContextBudget,
  type RuleEvidenceSummary,
} from "./contextModel";

const SEG_KEY = {
  always: "ctx.budget.always",
  conditional: "ctx.budget.conditional",
  irrelevant: "ctx.budget.irrelevant",
  skills: "ctx.budget.skills",
  surface: "ctx.budget.surface",
} as const;

const SEG_TITLE = {
  always: "ctx.budget.alwaysTitle",
  conditional: "ctx.budget.conditionalTitle",
  irrelevant: "ctx.budget.irrelevantTitle",
  skills: "ctx.budget.skillsTitle",
  surface: "ctx.budget.surfaceTitle",
} as const;

interface ContextBudgetBarProps {
  budget: ContextBudget;
  /** 계측이 아직 도는 중 — 조건부 조각이 자랄 수 있다고 알린다. */
  scanning: boolean;
  /** 예산으로 끊겨 남은 transcript 가 있다. */
  partial: boolean;
  /** 감사가 도는 중 — 무관 조각이 아직 자랄 수 있다. */
  auditing: boolean;
  /** 무관 조각 클릭 → 존 3 의 범위 교정 카드로 (D2: 예산 바에서 처방으로). */
  onJumpToIrrelevant: () => void;
  /**
   * evidence-based-rules — **값어치** 쪽 숫자.
   *
   * 이 바는 여태 비용(바이트)만 말했다. "이 상시 비용을 치를 만한가"에 답하려면
   * 반대편 숫자가 있어야 한다: 규칙 몇 개가 실제로 다시 난 결함에 이어져 있는가.
   * 근거가 하나도 없으면 이 줄은 **그리지 않는다** — 0은 말할 것이 없는 상태다.
   */
  evidence: Map<string, RuleEvidenceSummary>;
}

export function ContextBudgetBar({
  budget,
  scanning,
  partial,
  auditing,
  onJumpToIrrelevant,
  evidence,
}: ContextBudgetBarProps) {
  useT();
  // 눈금은 기준선(90KB)에 맞춘다 — 줄어드는 게 보여야 줄일 마음이 든다.
  // 기준선을 넘으면 눈금이 따라 늘어난다 (막대가 넘치지 않게).
  const scale = Math.max(budget.totalBytes, BUDGET_BASELINE_BYTES);
  const pct = (bytes: number) => `${((bytes / scale) * 100).toFixed(2)}%`;

  return (
    <section className="ctx-budget" aria-label={t("ctx.budget.aria")}>
      <div className="ctx-budget-head">
        <PieChart size={14} />
        <span className="ctx-budget-title">{t("ctx.budget.title")}</span>
        <strong className="ctx-budget-total">{t("ctx.budget.kb", { kb: kb(budget.totalBytes) })}</strong>
        <span className="ctx-budget-note">
          {t("ctx.budget.target", { kb: kb(BUDGET_TARGET_BYTES) })}
        </span>
        {scanning ? <span className="sk-chip">{t("firing.measuring")}</span> : null}
        {auditing ? <span className="sk-chip">{t("ctx.auditing")}</span> : null}
        {!scanning && partial ? <span className="sk-chip">{t("firing.partial")}</span> : null}
        {!budget.measured ? <span className="sk-chip">{t("ctx.budget.unmeasured")}</span> : null}
      </div>

      <div
        className="ctx-budget-bar"
        role="img"
        aria-label={t("ctx.budget.barAria", { kb: kb(budget.totalBytes) })}
      >
        {budget.segments.map((seg) => {
          if (seg.bytes <= 0) return null;
          const label = `${t(SEG_KEY[seg.id])} · ${kb(seg.bytes)}KB — ${t(SEG_TITLE[seg.id])}`;
          // 무관 조각만 클릭 가능하다 — 비용을 보여 준 자리에서 처방으로 간다.
          return seg.id === "irrelevant" ? (
            <button
              key={seg.id}
              type="button"
              className="ctx-seg irrelevant"
              style={{ width: pct(seg.bytes) }}
              title={label}
              aria-label={t("ctx.budget.jumpAria")}
              onClick={onJumpToIrrelevant}
            />
          ) : (
            <span
              key={seg.id}
              className={`ctx-seg ${seg.id}`}
              style={{ width: pct(seg.bytes) }}
              title={label}
            />
          );
        })}
        {/* 목표 눈금 — 재설계가 향하는 지점(마스터플랜 §5). */}
        <span className="ctx-budget-tick" style={{ left: pct(BUDGET_TARGET_BYTES) }} aria-hidden="true" />
      </div>

      <ul className="ctx-budget-legend">
        {budget.segments.map((seg) => (
          <li key={seg.id}>
            <span className={`ctx-dot ${seg.id}`} aria-hidden="true" />
            {t(SEG_KEY[seg.id])}
            <span className="ctx-legend-val">{t("ctx.budget.kb", { kb: kb(seg.bytes) })}</span>
          </li>
        ))}
      </ul>

      {evidence.size > 0 ? (
        <p className="ctx-budget-note">
          {t("ctx.evidence.summary", {
            n: evidence.size,
            m: [...evidence.values()].reduce((sum, e) => sum + e.hits, 0),
          })}
        </p>
      ) : null}
    </section>
  );
}
