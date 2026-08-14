import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RefreshCw } from "@/components/Icons";
import { commands, type AcpUsage } from "@/lib/bindings";
import { useT } from "@/i18n";
import { useDismiss } from "./useDismiss";
import { relativeTime } from "./relativeTime";

// PR-ACP11 — 툴바의 사용량 계기.
//
// 한도는 `usage_update` 에 실려 오는데 **한 번에 한 종류씩**이라, 백엔드가
// 종류별로 누적한 것을 여기서 읽는다. 세션·주간·Fable 세 줄이 다 모이려면
// 턴이 몇 번 돌아야 하므로, 아직 못 본 줄은 그리지 않는다 — 0% 로 그리면
// "여유롭다"는 거짓말이 된다.

/** 어댑터가 주는 종류 문자열 → 사람이 읽는 이름. 모르는 종류는 원문 그대로. */
const LIMIT_LABEL: Readonly<Record<string, string>> = {
  five_hour: "acp.limit.session",
  seven_day: "acp.limit.week",
  seven_day_opus: "acp.limit.weekOpus",
  seven_day_fable: "acp.limit.weekFable",
};

function pct(utilization: number | null): number {
  return Math.round(Math.min(1, Math.max(0, utilization ?? 0)) * 100);
}

/** 임계에 따른 색 — 숫자만으로는 "이제 아껴야 하나"가 안 읽힌다. */
function toneOf(utilization: number | null): string {
  const value = utilization ?? 0;
  if (value >= 0.9) return " danger";
  if (value >= 0.75) return " warn";
  return "";
}

export function AcpUsageMeter({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [usage, setUsage] = useState<AcpUsage | null>(null);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []));

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await commands.acpUsage(projectId);
      if (res.status === "ok") setUsage(res.data);
    } finally {
      setRefreshing(false);
    }
  }, [projectId]);

  // 턴이 끝날 때마다 바뀌므로 주기적으로 읽는다. 로컬 상태 조회라 값싸다
  // (네트워크도 에이전트 왕복도 없다).
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const limits = usage?.limits ?? [];
  if (!limits.length) return null;

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"usage-meter" + (open ? " open" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("acp.usageTitle")}
        onClick={() => setOpen((v) => !v)}
      >
        {limits.map((limit) => (
          <span key={limit.kind} className={"usage-pill" + toneOf(limit.utilization)}>
            {pct(limit.utilization)}%
          </span>
        ))}
      </button>
      {open ? (
        <div className="settings-menu usage-menu" role="dialog" aria-label={t("acp.usageTitle")}>
          <div className="usage-head">
            <span className="settings-group-label">{t("acp.usageTitle")}</span>
            <button
              type="button"
              className="btn icon ghost"
              disabled={refreshing}
              onClick={() => void refresh()}
              aria-label={t("acp.usageRefresh")}
              title={t("acp.usageRefresh")}
            >
              <RefreshCw size={13} />
            </button>
          </div>

          {limits.map((limit) => {
            const labelKey = LIMIT_LABEL[limit.kind];
            const resets = limit.resets_at
              ? relativeTime(new Date(limit.resets_at * 1000).toISOString(), Date.now())
              : null;
            return (
              <div key={limit.kind} className="usage-row">
                <div className="usage-row-head">
                  <span className="usage-row-name">
                    {labelKey ? t(labelKey as Parameters<typeof t>[0]) : limit.kind}
                  </span>
                  <span className={"usage-row-pct" + toneOf(limit.utilization)}>
                    {pct(limit.utilization)}%
                  </span>
                </div>
                <div className="usage-bar">
                  <span
                    className={"usage-bar-fill" + toneOf(limit.utilization)}
                    style={{ width: `${pct(limit.utilization)}%` }}
                  />
                </div>
                {resets ? (
                  <span className="usage-row-reset">{t("acp.usageResets", { at: resets })}</span>
                ) : null}
              </div>
            );
          })}

          {usage ? (
            <div className="usage-context">
              <Check size={12} />
              {t("acp.usageContext", {
                pct: Math.round((usage.used / Math.max(usage.size, 1)) * 100),
                cost: usage.cost_usd != null ? `$${usage.cost_usd.toFixed(2)}` : "—",
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
