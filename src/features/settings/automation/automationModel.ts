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

/** 자동화의 두 축. 백엔드 `AutomationKind` 와 같은 어휘. */
export const KINDS = ["schedule", "watcher"] as const;

/**
 * 반응성 티어 6단 — 백엔드 `automation::tiers::Responsiveness` 와 같은 목록·순서.
 * 지연 값은 **화면 문구에만** 쓴다 (판정은 백엔드가 소유한다).
 */
export const RESPONSIVENESS = [
  "fast",
  "balanced",
  "patient",
  "relaxed",
  "deferred",
  "extended",
] as const;
export type ResponsivenessId = (typeof RESPONSIVENESS)[number];

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
 * 저장 전에 프런트가 막을 수 있는 것만 막는다 — 빈도·감시 경로의 진짜 판정은
 * 백엔드(`ScheduleSpec::from_def` · `settle::watch_error`)가 소유한다
 * (한 규칙을 두 벌 들지 않는다). 반환값은 i18n 키 또는 `null`.
 */
export function localValidation(def: AutomationDef): string | null {
  if (!def.title.trim()) return "automation.err.titleRequired";
  if (!def.instructions.trim()) return "automation.err.instructionsRequired";
  if (!def.id.trim()) return "automation.err.idRequired";
  // 감시 경로는 fs 접근이 아니라 접두 비교에만 쓰이지만, `..`·절대경로는 어떤
  // 상대 경로와도 만나지 않아 **영원히 안 도는 자동화**가 된다.
  if (def.kind === "watcher") {
    const watch = (def.watch ?? "").trim().replace(/\\/g, "/");
    if (watch.startsWith("/") || watch.split("/").includes("..")) {
      return "automation.err.badWatch";
    }
  }
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
 * 카드 한 줄 요약 — 스케줄이면 반복 문장, 워처면 감시 범위와 티어.
 * 한 함수가 두 축을 다 안다: 목록은 둘을 섞어 그린다.
 */
export function describeAutomation(def: AutomationDef): string {
  return def.kind === "watcher" ? describeWatcher(def) : describeSchedule(def);
}

/** "src/ 감시 · 손이 멎고 5분 뒤" — 워처 카드의 한 줄. */
export function describeWatcher(def: AutomationDef): string {
  const raw = (def.watch ?? "").trim();
  const scope = raw === "" || raw === "." ? t("automation.watch.root") : raw;
  const tier = RESPONSIVENESS.includes((def.responsiveness ?? "") as ResponsivenessId)
    ? (def.responsiveness as ResponsivenessId)
    : "balanced";
  const settle = t(`automation.tierName.${tier}` as never);
  const depth = def.recursive === false ? t("automation.watch.flat") : t("automation.watch.deep");
  return t("automation.watch.summary", { scope, depth, settle });
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

/**
 * 새 정의의 빈 껍데기. `today` 는 주입 — 여기서 시계를 읽지 않는다.
 * 두 축의 기본값이 다르다: 스케줄은 매일 09:00, 워처는 프로젝트 루트를
 * `balanced` 로 본다.
 */
export function blankDefinition(
  today: string,
  kind: AutomationDef["kind"] = "schedule"
): AutomationDef {
  const watcher = kind === "watcher";
  return {
    id: "",
    kind,
    title: "",
    enabled: false,
    created: today,
    updated: today,
    frequency: watcher ? null : "daily",
    at: watcher ? null : "09:00",
    weekday: null,
    day_of_month: null,
    month: null,
    day: null,
    every: null,
    cron: null,
    watch: watcher ? "." : null,
    recursive: watcher ? true : null,
    responsiveness: watcher ? "balanced" : null,
    output: watcher ? "journal" : "none",
    instructions: "",
  };
}

/**
 * 종류를 바꾸면 반대편 축의 필드를 비운다 — 스케줄 필드를 들고 있는 워처 정의는
 * 디스크에 쓰이면 사람을 헷갈리게 한다 (파일이 SSOT 다).
 */
export function switchKind(def: AutomationDef, kind: AutomationDef["kind"]): AutomationDef {
  if (def.kind === kind) return def;
  const blank = blankDefinition(def.updated, kind);
  return {
    ...blank,
    id: def.id,
    title: def.title,
    created: def.created,
    instructions: def.instructions,
    enabled: false, // 축이 바뀌면 다시 켜는 것은 사용자의 결정이다
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
