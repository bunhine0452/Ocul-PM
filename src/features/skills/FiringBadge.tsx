// AD-2 — 발동 배지. "이게 실제로 걸리기는 하는가"를 목록에서 바로 답한다.
// 계측이 아직 안 돌았을 때(=원장 비어 있음)와 "0회"는 다른 상태다 — 전자는
// 아무것도 그리지 않고, 후자만 휴면으로 표시한다.
//
// `#dormant-three-ways` — 그 "0회" 도 한 마디가 아니다. 방금 설치한 것 · 이
// 프로젝트엔 해당 없는 것 · 사람이 안 부른 것 · **걸릴 만한데 안 걸린 것**은
// 서로 다른 사실이고, 마지막 하나만이 사용자가 손댈 자리다. 넷을 같은 말로
// 부르면 진짜 발견이 나머지 셋의 소음에 묻힌다.
import type { FiringStat } from "@/lib/bindings";
import { t } from "@/i18n";
import { shortWorkday } from "./firingModel";
import type { DormantReason } from "./contextModel";

interface FiringBadgeProps {
  stat: FiringStat | undefined;
  /** 원장이 한 번이라도 스캔됐는가 — false 면 "0회" 를 주장하지 않는다. */
  measured: boolean;
  days: number;
  /** 0회의 이유. 없으면 종전대로 뭉뚱그린 「안 걸림」. */
  reason?: DormantReason;
}

/** 배지 한 장의 문구·툴팁·겉모습. `genuine` 만 발견처럼 보여야 한다. */
interface DormantShape {
  label: string;
  title: string;
  /** 추가 클래스. 점선 테두리(`dormant`)는 "손댈 자리" 에만 붙인다. */
  tone: string;
}

function dormantShape(reason: DormantReason | undefined, days: number): DormantShape {
  switch (reason) {
    case "user-invoked":
      return {
        label: t("firing.dormant.byHand"),
        title: t("firing.dormant.byHandTitle"),
        tone: "",
      };
    case "too-new":
      return {
        label: t("firing.dormant.tooNew"),
        title: t("firing.dormant.tooNewTitle", { d: days }),
        tone: "",
      };
    case "precondition-missing":
      return { label: t("firing.dormant.na"), title: t("firing.dormant.naTitle"), tone: "" };
    case "suppressed":
      return { label: t("firing.dormant.na"), title: t("firing.dormant.suppressedTitle"), tone: "" };
    // 이유를 모르면(감사 전 · 규칙 항목) 종전 문구 그대로 — 모르는 것을 아는
    // 척하지 않는다. `genuine` 도 같은 자리다: 넷을 다 지나온 진짜 0회다.
    default:
      return {
        label: t("firing.dormant"),
        title: t("firing.dormantTitle", { d: days }),
        tone: " dormant",
      };
  }
}

export function FiringBadge({ stat, measured, days, reason }: FiringBadgeProps) {
  if (!measured) return null;
  if (!stat || stat.count === 0) {
    const shape = dormantShape(reason, days);
    return (
      <span className={`sk-chip${shape.tone}`} title={shape.title}>
        {shape.label}
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
