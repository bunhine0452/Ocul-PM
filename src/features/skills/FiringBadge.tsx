// AD-2 — 발동 배지. "이게 실제로 걸리기는 하는가"를 목록에서 바로 답한다.
// 계측이 아직 안 돌았을 때(=원장 비어 있음)와 "0회"는 다른 상태다 — 전자는
// 아무것도 그리지 않고, 후자만 휴면으로 표시한다.
import type { FiringStat } from "@/lib/bindings";
import { t } from "@/i18n";
import { shortWorkday } from "./firingModel";

interface FiringBadgeProps {
  stat: FiringStat | undefined;
  /** 원장이 한 번이라도 스캔됐는가 — false 면 "0회" 를 주장하지 않는다. */
  measured: boolean;
  days: number;
}

export function FiringBadge({ stat, measured, days }: FiringBadgeProps) {
  if (!measured) return null;
  if (!stat || stat.count === 0) {
    return (
      <span className="sk-chip dormant" title={t("firing.dormantTitle", { d: days })}>
        {t("firing.dormant")}
      </span>
    );
  }
  const last = stat.last_workday ? shortWorkday(stat.last_workday) : "";
  return (
    <span
      className="sk-chip live"
      title={t("firing.liveTitle", { n: stat.count, d: days, s: stat.sessions, last })}
    >
      {t("firing.count", { n: stat.count })}
    </span>
  );
}
