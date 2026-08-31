// 자동화 탭의 순수 파트 — 요약 문장·유효성·정렬. React 없이 시험한다.
//
// 시각 포맷은 **주입받은 `now`** 를 쓴다 (`Date.now()` 직접 호출 금지 규율).
// 백엔드가 넘기는 시각은 전부 UTC ISO 이고, 여기서 로컬로 되돌려 그린다.

import type { AutomationDef, AutomationSummary } from "@/lib/bindings";
import { t } from "@/i18n";

/** 정의 파일의 `frequency:` 어휘. 백엔드 `Frequency::as_str` 과 같은 목록. */
export const FREQUENCIES = [
  "once",
  "minutes",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "cron",
] as const;
export type FrequencyId = (typeof FREQUENCIES)[number];

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** 자동화가 남기는 것. 백엔드 `AutomationOutput` 과 같은 어휘. */
export const OUTPUTS = ["journal", "plan", "none"] as const;

/** 빈도마다 어떤 필드를 쓰는가 — 에디터가 이걸 보고 입력칸을 켠다. */
export function fieldsFor(freq: string): {
  at: boolean;
  atIsDateTime: boolean;
  every: boolean;
  weekday: boolean;
  dayOfMonth: boolean;
  monthDay: boolean;
  cron: boolean;
} {
  return {
    at: ["once", "hourly", "daily", "weekly", "monthly", "yearly"].includes(freq),
    atIsDateTime: freq === "once",
    every: freq === "minutes" || freq === "hourly",
    weekday: freq === "weekly",
    dayOfMonth: freq === "monthly",
    monthDay: freq === "yearly",
    cron: freq === "cron",
  };
}

/**
 * 저장 전에 프런트가 막을 수 있는 것만 막는다 — 빈도 조합의 진짜 판정은
 * 백엔드 `ScheduleSpec::from_def` 이 소유한다 (한 규칙을 두 벌 들지 않는다).
 * 반환값은 i18n 키 또는 `null`.
 */
export function localValidation(def: AutomationDef): string | null {
  if (!def.title.trim()) return "automation.err.titleRequired";
  if (!def.instructions.trim()) return "automation.err.instructionsRequired";
  if (!def.id.trim()) return "automation.err.idRequired";
  return null;
}

/** 자동화 상태를 한 낱말로 — 카드 배지가 쓴다. */
export type CardState = "broken" | "paused" | "active";

export function cardState(s: AutomationSummary): CardState {
  if (s.spec_error) return "broken";
  return s.def.enabled ? "active" : "paused";
}

/**
 * 목록 정렬: 고장난 것 먼저(눈에 띄어야 한다) → 활성 → 일시중지, 각 묶음 안에서
 * 다음 실행이 이른 순, 없으면 제목 순.
 */
export function sortSummaries(list: AutomationSummary[]): AutomationSummary[] {
  const rank: Record<CardState, number> = { broken: 0, active: 1, paused: 2 };
  return [...list].sort((a, b) => {
    const byState = rank[cardState(a)] - rank[cardState(b)];
    if (byState !== 0) return byState;
    const an = a.next_run_at ?? "";
    const bn = b.next_run_at ?? "";
    if (an && bn && an !== bn) return an < bn ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    return a.def.title.localeCompare(b.def.title);
  });
}

/** ISO(UTC) → 로컬 표시. 값이 없거나 깨졌으면 `null`. */
export function formatAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "매주 금 17:00" 처럼 사람이 읽는 반복 문장. 번역 키를 조립하되 **문장을 코드에
 * 쓰지 않는다** (`lint:i18n`).
 */
export function describeSchedule(def: AutomationDef): string {
  const at = def.at ?? "";
  switch (def.frequency) {
    case "once":
      return t("automation.freq.onceAt", { at });
    case "minutes":
      return t("automation.freq.everyMinutes", { n: String(def.every ?? 0) });
    case "hourly":
      return t("automation.freq.everyHours", { n: String(def.every ?? 1), at });
    case "daily":
      return t("automation.freq.dailyAt", { at });
    case "weekly":
      return t("automation.freq.weeklyAt", {
        weekday: t(`automation.weekday.${def.weekday ?? "mon"}` as never),
        at,
      });
    case "monthly":
      return t("automation.freq.monthlyAt", { day: String(def.day_of_month ?? 1), at });
    case "yearly":
      return t("automation.freq.yearlyAt", {
        month: String(def.month ?? 1),
        day: String(def.day ?? 1),
        at,
      });
    case "cron":
      return t("automation.freq.cronAt", { expr: def.cron ?? "" });
    default:
      return t("automation.freq.unknown");
  }
}

/** 새 정의의 빈 껍데기. `today` 는 주입 — 여기서 시계를 읽지 않는다. */
export function blankDefinition(today: string): AutomationDef {
  return {
    id: "",
    kind: "schedule",
    title: "",
    enabled: false,
    created: today,
    updated: today,
    frequency: "daily",
    at: "09:00",
    weekday: null,
    day_of_month: null,
    month: null,
    day: null,
    every: null,
    cron: null,
    watch: null,
    recursive: null,
    responsiveness: null,
    output: "none",
    instructions: "",
  };
}

/** 제목 → ASCII kebab id. 백엔드 `store::normalize_id` 와 같은 규칙. */
export function slugify(raw: string): string {
  let out = "";
  let prevDash = false;
  for (const ch of raw.trim()) {
    const c = ch.toLowerCase();
    if (/[a-z0-9]/.test(c)) {
      out += c;
      prevDash = false;
    } else if (!prevDash && out.length > 0) {
      out += "-";
      prevDash = true;
    }
  }
  return out.replace(/-+$/, "");
}
