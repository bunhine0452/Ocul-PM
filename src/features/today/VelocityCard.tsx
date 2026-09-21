import { useEffect, useState } from "react";

import { ErrorCard } from "@/components/ErrorCard";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import type { TypeCounts, Velocity, WeekBucket } from "@/lib/bindings";
import { TRIGGER_META } from "@/features/oculpm/triggerMeta";
import { useT } from "@/i18n";

/** 카드가 보여주는 창 — 헤더에 그대로 「최근 8주」로 표기. */
const WEEKS = 8;

/** `TypeCounts` 를 쌓는 순서(아래→위) — 백엔드 struct 필드 순서와 같다. */
const TYPE_ORDER: (keyof TypeCounts)[] = ["feature", "bug", "error", "refactor", "chore"];

/**
 * journal-scale-round `{#velocity-card}` — 주당 일지 건수·유형 비율 추이와
 * 플랜 완료 속도(ETA). 집계·ETA 계산은 백엔드 SSOT
 * (`db::velocity::Db::velocity` 의 doc comment) — 이 카드는 그 결과를
 * 그릴 뿐이다.
 *
 * `HotspotCard`(`{#hotspot-card}`)와 같은 선: 0건이어도 카드는 남고, 빈
 * 상태 문구로 "신호 없음" 과 "카드가 안 그려짐" 을 구분한다.
 */
export function VelocityCard({ projectId, enabled }: { projectId: number; enabled: boolean }) {
  const { t } = useT();
  const [data, setData] = useState<Velocity | null>(null);
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
        const res = await oculpmApi.velocity(projectId, WEEKS);
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
        title={t("today.velocity.failed")}
        error={error}
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }
  if (loading || !data) return null;

  const weeks = data.weeks;
  const clean = weeks.every((w) => w.total === 0);
  const maxTotal = Math.max(1, ...weeks.map((w) => w.total));

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
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: "var(--fw-bold)" }}>{t("today.velocity.title")}</span>
        <span
          style={{
            fontSize: "var(--fs-3)",
            fontWeight: "var(--fw-bold)",
            color: "var(--text-3)",
          }}
        >
          {t("today.velocity.window", { n: WEEKS })}
        </span>
      </div>

      {clean ? (
        <div style={{ fontSize: "var(--fs-3)", color: "var(--text-3)", lineHeight: 1.6 }}>
          {t("today.velocity.zeroNote", { n: WEEKS })}
        </div>
      ) : (
        <>
          <div style={{ fontSize: "var(--fs-3)", color: "var(--text-2)", marginBottom: 6 }}>
            {t("today.velocity.desc")}
          </div>

          <div className="velocity-row">
            {weeks.map((w, i) => (
              <VelocityColumn
                key={w.iso_week}
                week={w}
                maxTotal={maxTotal}
                isCurrent={i === weeks.length - 1}
              />
            ))}
          </div>

          <div className="velocity-legend">
            {TYPE_ORDER.map((ty) => (
              <span className="velocity-legend-item" key={ty}>
                <span
                  className="velocity-dot"
                  style={{ background: `var(--t-${TRIGGER_META[ty].cssVar})` }}
                />
                {t(TRIGGER_META[ty].labelKey)}
              </span>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: "var(--fs-3)", color: "var(--text-2)", marginTop: 10 }}>
        <PlanSummaryLine plan={data.plan} />
      </div>
    </section>
  );
}

function VelocityColumn({
  week,
  maxTotal,
  isCurrent,
}: {
  week: WeekBucket;
  maxTotal: number;
  isCurrent: boolean;
}) {
  const { t } = useT();
  const fillPct = (week.total / maxTotal) * 100;
  return (
    <div className="velocity-col">
      <div className="velocity-val">{week.total}</div>
      <div
        className={"velocity-bar" + (isCurrent ? " is-today" : "")}
        style={{ flex: 1 }}
        title={`${week.iso_week} · ${t("today.velocity.total", { n: week.total })}`}
      >
        <div className="velocity-fill" style={{ height: `${fillPct}%` }}>
          {TYPE_ORDER.map((ty) => {
            const cnt = week.by_type[ty];
            if (!cnt) return null;
            return (
              <i
                key={ty}
                style={{ flex: `${cnt} 0 0`, background: `var(--t-${TRIGGER_META[ty].cssVar})` }}
                title={`${t(TRIGGER_META[ty].labelKey)} ${cnt}`}
              />
            );
          })}
        </div>
      </div>
      <div className={"velocity-lbl" + (isCurrent ? " is-today" : "")}>
        {shortLabel(week.from_workday)}
      </div>
    </div>
  );
}

function PlanSummaryLine({ plan }: { plan: Velocity["plan"] }) {
  const { t } = useT();
  if (plan.eta_weeks == null) {
    return <>{t("today.velocity.summaryNoEta")}</>;
  }
  return (
    <>
      {t("today.velocity.summary", {
        open: plan.open_items,
        avg: (plan.weekly_done_avg ?? 0).toFixed(1),
        eta: Math.round(plan.eta_weeks),
      })}
    </>
  );
}

/** "YYYYMMDD" → "M/D" (locale-agnostic 숫자 표기라 i18n 이 필요 없다). */
function shortLabel(workday: string): string {
  const m = Number(workday.slice(4, 6));
  const d = Number(workday.slice(6, 8));
  if (Number.isNaN(m) || Number.isNaN(d)) return workday;
  return `${m}/${d}`;
}
