import { useEffect, useState } from "react";

import { ErrorCard } from "@/components/ErrorCard";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import type { PromiseScorecard } from "@/lib/bindings";
import { useT } from "@/i18n";

/** 카드가 보는 창 — 헤더에 그대로 「최근 30일」. */
const DAYS = 30;

/**
 * `docs/PROMISE.md` 「측정 목표」 표의 **지금** 열 — 목표는 그 문서의 숫자를 그대로
 * 둔다(증거 97% · 7일 재수정 30% 이하 · 활성 플랜 전부에 완료 조건·확인 명령).
 * 바뀌면 문서와 함께 바꾼다.
 */
const TARGET_EVIDENCE = 97;
const TARGET_REWORK = 30;

/**
 * best-results-round `{#scorecard-card}` — 「약속 성적표」. 느낌 대신 숫자
 * (METR: 개발자는 AI 로 빨라졌다고 느꼈고 실측은 반대였다). 정의는 백엔드
 * (`db::scorecard`)가 성적표 스크립트와 같은 계약으로 산다 — 이 카드는 그릴 뿐이다.
 *
 * `HotspotCard` 와 같은 선: 0건이어도 카드는 남고, 빈 상태 문구로 「데이터 없음」과
 * 「카드가 안 그려짐」을 가른다.
 */
export function PromiseScorecardCard({ projectId, enabled }: { projectId: number; enabled: boolean }) {
  const { t } = useT();
  const [data, setData] = useState<PromiseScorecard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await oculpmApi.promiseScorecard(projectId, DAYS);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setError(e instanceof OculpmApiError ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled, nonce]);

  if (!enabled) return null;
  if (error && !loading) {
    return (
      <ErrorCard
        title={t("today.scorecard.title")}
        error={error}
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }
  // `journal`/`plans` 가 없는 응답은 성적표가 아니다 — 그리지 않는다(a11y 스위프의 빈 프록시도 여기서 걸린다).
  if (loading || !data?.journal || !data.plans) return null;

  const { journal, plans } = data;
  const pct = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 100));
  const evidence = pct(journal.evidence_entries, journal.judged_entries);
  const rework = pct(journal.rework_within_7d, journal.bug_entries);
  const plansOk = plans.active_plans > 0 && plans.with_done_when === plans.active_plans && plans.with_check === plans.active_plans;

  const rows: { label: string; now: string; target: string; ok: boolean | null }[] = [
    {
      label: t("today.scorecard.evidence"),
      now: evidence === null ? t("today.scorecard.na") : `${evidence}%`,
      target: `≥ ${TARGET_EVIDENCE}%`,
      ok: evidence === null ? null : evidence >= TARGET_EVIDENCE,
    },
    {
      label: t("today.scorecard.rework"),
      now: rework === null ? t("today.scorecard.na") : `${rework}%`,
      target: `≤ ${TARGET_REWORK}%`,
      ok: rework === null ? null : rework <= TARGET_REWORK,
    },
    {
      label: t("today.scorecard.plans"),
      now:
        plans.active_plans === 0
          ? t("today.scorecard.na")
          : `${plans.with_done_when} · ${plans.with_check} / ${plans.active_plans}`,
      target: t("today.scorecard.plansTarget"),
      ok: plans.active_plans === 0 ? null : plansOk,
    },
  ];
  const empty = journal.judged_entries === 0 && journal.bug_entries === 0 && plans.active_plans === 0;

  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: "var(--bg-inset)",
        border: "1px solid var(--border-card)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ fontWeight: "var(--fw-bold)" }}>{t("today.scorecard.title")}</span>
        <span style={{ fontSize: "var(--fs-3)", fontWeight: "var(--fw-bold)", color: "var(--text-3)" }}>
          {t("today.scorecard.window", { n: data.window_days })}
        </span>
      </div>
      <div style={{ fontSize: "var(--fs-3)", color: "var(--text-3)", lineHeight: 1.6, marginBottom: 8 }}>
        {empty ? t("today.scorecard.empty") : t("today.scorecard.desc")}
      </div>
      {empty ? null : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-3)" }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={{ borderTop: "1px solid var(--border-card)" }}>
                <td style={{ padding: "6px 0", color: "var(--text-2)" }}>{r.label}</td>
                <td
                  style={{
                    padding: "6px 8px",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: "var(--fw-bold)",
                    color: r.ok === null ? "var(--text-3)" : r.ok ? "var(--ok)" : "var(--warn)",
                  }}
                >
                  {r.now}
                </td>
                <td style={{ padding: "6px 0", textAlign: "right", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                  {t("today.scorecard.target", { target: r.target })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {empty ? null : (
        <div style={{ fontSize: "var(--fs-2)", color: "var(--text-3)", marginTop: 6 }}>
          {t("today.scorecard.foot", {
            judged: journal.judged_entries,
            bugs: journal.bug_entries,
            hub: journal.hub_cut,
          })}
        </div>
      )}
    </section>
  );
}
