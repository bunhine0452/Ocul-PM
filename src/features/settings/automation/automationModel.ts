// 자동화 탭의 순수 파트 — 요약 문장·유효성·정렬. React 없이 시험한다.
//
// 시각 포맷은 **주입받은 `now`** 를 쓴다 (`Date.now()` 직접 호출 금지 규율).
// 백엔드가 넘기는 시각은 전부 UTC ISO 이고, 여기서 로컬로 되돌려 그린다.

import type {
  AutomationCondition,
  AutomationDef,
  AutomationSummary,
  ConditionWhen,
  ModelEgress,
} from "@/lib/bindings";
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
 * 정의가 값을 들고 있지만 **이 빈도·종류에서는 러너가 읽지 않는** 필드
 * (Osaurus 라운드 Phase 6 `#not-honored-notice`).
 *
 * 빈도를 바꿔도 옛 값이 파일에 남는다 — `weekly` 였다가 `daily` 가 된 정의는
 * `weekday: mon` 을 계속 들고 있고, 러너는 그걸 무시한다. 지금까지는 조용히
 * 무시됐다. 에디터가 「선언됐지만 아직 이행하지 않음」으로 적는다.
 *
 * 순수 함수다 — 화면 없이 단언할 수 있어야 회귀가 잡힌다.
 */
export function unusedFieldsFor(def: AutomationDef): string[] {
  const out: string[] = [];
  if (def.kind === "watcher") {
    // 워처는 빈도 필드를 전부 안 읽는다 — 정착 타이머가 시각을 소유한다.
    for (const [name, value] of [
      ["frequency", def.frequency],
      ["at", def.at],
      ["weekday", def.weekday],
      ["cron", def.cron],
      ["every", def.every],
      ["day_of_month", def.day_of_month],
      ["month", def.month],
      ["day", def.day],
    ] as const) {
      if (value != null && value !== "") out.push(name);
    }
    return out;
  }

  const fields = fieldsFor(def.frequency ?? "");
  const carried: Array<[string, unknown, boolean]> = [
    ["at", def.at, fields.at],
    ["every", def.every, fields.every],
    ["weekday", def.weekday, fields.weekday],
    ["day_of_month", def.day_of_month, fields.dayOfMonth],
    ["month", def.month, fields.monthDay],
    ["day", def.day, fields.monthDay],
    ["cron", def.cron, fields.cron],
  ];
  for (const [name, value, used] of carried) {
    if (!used && value != null && value !== "") out.push(name);
  }
  // 스케줄은 감시 필드를 안 읽는다.
  if (def.watch) out.push("watch");
  if (def.responsiveness) out.push("responsiveness");
  return out;
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
    // 기본은 조건 없음 = 항상 실행 — 새 자동화가 말없이 안 도는 일이 없게.
    conditions: [],
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
    // 조건은 두 축이 공유하므로 그대로 들고 간다 (일지 수·플랜·git 은 종류와 무관).
    conditions: def.conditions,
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

// ─────────────────────────────────────────────────────────────────────────────
// 실행 조건 ({#automation-step-if})
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 고를 수 있는 조건. 백엔드 `ConditionWhen::ALL` 과 **같은 목록·같은 순서**다.
 * `unknown` 은 여기 없다 — 판정 결과이지 어휘가 아니라, 사람이 고를 수 없다.
 */
export const CONDITIONS = [
  "journal_count_gte",
  "plan_has_open_items",
  "git_dirty",
] as const;

/** 임계값(`n`)을 읽는 조건. 백엔드 `ConditionWhen::takes_threshold` 와 같다. */
export function takesThreshold(when: ConditionWhen): boolean {
  return when === "journal_count_gte";
}

/** 새 조건 한 줄. 임계값을 안 쓰는 조건에는 `n` 을 달지 않는다 (파일이 거짓말하지 않게). */
export function newCondition(when: ConditionWhen): AutomationCondition {
  return { when, n: takesThreshold(when) ? 3 : null, raw: null };
}

/**
 * 조건 목록의 한 줄 요약 — 카드가 쓴다. 조건이 없으면 `null` (줄을 만들지 않는다).
 */
export function describeConditions(def: AutomationDef): string | null {
  if (def.conditions.length === 0) return null;
  return def.conditions
    .map((c) =>
      c.when === "journal_count_gte"
        ? `${t("automation.cond.journal_count_gte")} (${c.n ?? 1})`
        : t(`automation.cond.${c.when}` as never)
    )
    .join(" · ");
}

// ─────────────────────────────────────────────────────────────────────────────
// 유출 배지 ({#automation-egress-badge})
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 배지에 적을 문장. `null` = 배지를 붙이지 않는다.
 *
 * 두 경우에 붙지 않는다:
 *
 * 1. **로컬 모델** — 내용이 기기를 안 벗어난다. 이 구분이 제품 약속의 핵심이고,
 *    지금까지 화면에 없던 것이 바로 이것이다.
 * 2. 배경 모델 미설정 — 아무것도 안 돈다 (그 사실은 게이트 안내가 따로 말한다).
 *
 * 판정(`local`)은 **백엔드가 소유한다** (`automation::egress`). 프런트가
 * 프로바이더 목록을 따로 들면 언젠가 어긋나고, 그때 배지가 조용히 거짓말을 한다.
 */
export function egressNotice(
  egress: ModelEgress | null | undefined
): { text: string; hint: string | null } | null {
  if (!egress) return null;
  const provider = providerLabel(egress.provider);
  if (egress.local) {
    return { text: t("automation.egress.local", { provider }), hint: null };
  }
  return {
    text: t("automation.egress.remote", { provider, host: egress.host }),
    hint: t("automation.egress.remoteHint"),
  };
}

/**
 * 프로바이더 id → 배지에 찍을 이름. 상표라 번역하지 않는다 (`lint:i18n` 은
 * 한글 리터럴만 본다). 모르는 id 는 **그대로** 보여 준다 — 아는 척하지 않는다.
 */
export function providerLabel(id: string): string {
  const known: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    gemini: "Google Gemini",
    nim: "NVIDIA NIM",
    openrouter: "OpenRouter",
  };
  return known[id] ?? id;
}
