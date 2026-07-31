/**
 * 메인 화면(프로젝트 선택) 모델 — 순수 함수만. React 의존 0.
 *
 * 화면의 질문은 하나다: **"어디서 이어서 일하지?"**
 * 그 답을 위계로 만드는 것이 이 파일의 일이다 — 오늘 손댄 프로젝트가 가장
 * 크게(사령탑), 최근 것이 그 다음(판), 나머지가 행, 2주 이상 조용한 것은
 * 레일 하단 색인으로 접힌다.
 *
 * 렌더 파일이 계산을 하지 않도록 여기서 전부 끝낸다 — 그래야 랭킹 규칙이
 * 한 곳에 있고 테스트할 수 있다.
 */
import type {
  HomeActivePlan,
  HomeBrief,
  HomeDayCount,
  HomeProjectBrief,
  OpenPlanItem,
  Project,
  ProjectBlueprint,
} from "@/lib/bindings";
import { bestScore } from "./homeMatch";

// ── 상수 (매직넘버 금지) ─────────────────────────────────────────────────
/** 사령탑 타일 수. */
export const HERO_MAX = 1;
/** 중간 밀도 "판" 타일 수. */
export const PANEL_MAX = 2;
/** 이 일수 이상 활동이 없으면 레일 하단 색인(조용한 프로젝트)으로 접는다. */
export const QUIET_DAYS = 14;
/** 활동 스파크라인 창 — 백엔드 home_brief(days) 와 같아야 한다. */
export const SPARK_DAYS = 14;
/** 오늘의 흐름 타일이 그리는 최대 행 수. */
export const FEED_MAX = 8;

const DAY_MS = 86_400_000;

// ── 타입 ────────────────────────────────────────────────────────────────

/** 한 프로젝트의 기록 요약. `null` 이면 아직 모름(로딩) 또는 기록 없음. */
export interface ProjectSnap {
  lastAt: string | null;
  lastTitle: string | null;
  lastType: string | null;
  lastAgentId: string | null;
  lastAgentVersion: string | null;
  todayCount: number;
  /** 길이 = SPARK_DAYS, 과거 → 오늘. */
  spark: number[];
  totalEntries: number;
  nextTasks: OpenPlanItem[];
  activePlan: HomeActivePlan | null;
  identity: string | null;
}

export interface ProjectRowT {
  kind: "project";
  id: string;
  project: Project;
  snap: ProjectSnap | null;
  /** 검색 중일 때의 매칭 점수 (정렬 근거). 검색이 아니면 null. */
  score: number | null;
}

export interface DraftRowT {
  kind: "draft";
  id: string;
  bp: ProjectBlueprint;
  stepLabel: string;
}

export interface CommandSpec {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

export interface CommandRowT extends CommandSpec {
  kind: "command";
}

export type HomeRow = ProjectRowT | DraftRowT | CommandRowT;

export interface HomeModel {
  hero: ProjectRowT | null;
  panels: ProjectRowT[];
  rows: ProjectRowT[];
  quiet: ProjectRowT[];
  drafts: DraftRowT[];
  commands: CommandRowT[];
  /**
   * 키보드 커서가 훑는 평면 — **레일 행들만** (rows → quiet → drafts → commands).
   *
   * 벤토 타일(hero/panels)은 여기 넣지 않는다. 타일의 제목 버튼은 평범한
   * `<button>` 이라 기본 탭 순서에 이미 들어 있고, 로빙 tabindex 로 관리되는
   * 것은 레일뿐이기 때문이다. 예전에 타일을 이 배열에 섞었더니 `flat[0]` 이
   * 커서에 등록되지 않은 hero 를 가리켜 **레일의 탭 스톱이 0개가 되고 ↓/↑/Home
   * 이 전부 죽었다** — 등록된 엘리먼트가 없어 focusRow 가 조용히 반환했다.
   */
  flat: HomeRow[];
  /**
   * 검색창에서 ⏎ 를 눌렀을 때 열 대상. 검색 중이면 1위 결과, 아니면 사령탑
   * (= "이어서 일하기"). `flat[0]` 과 다를 수 있으므로 별도 필드로 둔다.
   */
  primary: HomeRow | null;
  dateline: string;
  todayTotal: number;
  /** 검색 결과를 스크린리더에 알리는 문장 (aria-live). */
  liveMessage: string;
}

// ── 포매팅 ──────────────────────────────────────────────────────────────

/** 상대 시각. 기록이 없으면 대시 — 거짓 시각을 지어내지 않는다. */
export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / DAY_MS)}일 전`;
}

/** ISO 에서 `HH:MM` 만. 형식이 어긋나면 빈 문자열. */
export function hhmm(iso: string): string {
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : "";
}

/**
 * 홈 디렉터리를 `~` 로 접는다. 웹뷰에는 $HOME 이 없으므로 경로 모양으로
 * 판정한다 (macOS `/Users/<u>/`, Linux `/home/<u>/`).
 */
export function tildePath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

/** 프로젝트 마크용 이니셜 — 최대 2글자. */
export function initials(name: string): string {
  const parts = name.split(/[-_.\s/]+/).filter(Boolean);
  if (parts.length === 0) return "";
  // 한글은 한 글자로 충분하다 (두 글자를 붙이면 단어처럼 읽혀 오히려 헷갈린다).
  if (/[가-힣]/.test(parts[0][0])) return parts[0][0];
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 상단 데이트라인. `todayTotal` 이 `null` (아직 집계 전) 이면 건수 절을
 * 생략한다 — "오늘 0건" 이라고 단정하면 로딩 중에 거짓말이 된다.
 */
export function formatDateline(
  d: Date,
  todayTotal: number | null,
  projectCount: number,
): string {
  const date = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
  const parts = [date];
  if (todayTotal !== null) parts.push(`오늘 ${todayTotal}건`);
  parts.push(`프로젝트 ${projectCount}`);
  return parts.join(" · ");
}

// ── 파생 ────────────────────────────────────────────────────────────────

/** `YYYYMMDD` → epoch ms (로컬 자정). */
function workdayToMs(wd: string): number {
  const y = Number(wd.slice(0, 4));
  const m = Number(wd.slice(4, 6));
  const d = Number(wd.slice(6, 8));
  return new Date(y, m - 1, d).getTime();
}

/** epoch ms → `YYYYMMDD` (로컬). */
function msToWorkday(ms: number): string {
  const d = new Date(ms);
  return (
    d.getFullYear().toString().padStart(4, "0") +
    (d.getMonth() + 1).toString().padStart(2, "0") +
    d.getDate().toString().padStart(2, "0")
  );
}

/**
 * 희소 일별 버킷을 고정 길이 시계열로. 과거 → 오늘 순서이며, 값이 없는 날은
 * 0 이다. **길이는 항상 `len`** — 데이터가 없다고 배열이 짧아지면 스파크라인
 * 폭이 흔들려 레이아웃이 움직인다.
 */
export function sparkSeries(days: HomeDayCount[], since: string, len: number): number[] {
  const out = new Array(len).fill(0);
  if (!since || since.length < 8) return out;
  const base = workdayToMs(since);
  for (const d of days) {
    if (!d.workday || d.workday.length < 8) continue;
    const idx = Math.round((workdayToMs(d.workday) - base) / DAY_MS);
    if (idx >= 0 && idx < len) out[idx] += d.count;
  }
  return out;
}

/** 2주 이상 조용한가. 기록이 아예 없으면 조용한 쪽으로 본다. */
export function isQuiet(lastAt: string | null, now: number): boolean {
  if (!lastAt) return true;
  const t = Date.parse(lastAt);
  if (Number.isNaN(t)) return true;
  return now - t >= QUIET_DAYS * DAY_MS;
}

function toSnap(b: HomeProjectBrief, since: string): ProjectSnap {
  return {
    lastAt: b.last_at,
    lastTitle: b.last_title,
    lastType: b.last_type,
    lastAgentId: b.last_agent_id,
    lastAgentVersion: b.last_agent_version,
    todayCount: b.today_count,
    spark: sparkSeries(b.days, since, SPARK_DAYS),
    totalEntries: b.total_entries,
    nextTasks: b.next_tasks,
    activePlan: b.active_plan,
    identity: b.identity,
  };
}

/** 그린필드 마법사 단계 라벨 (기존 StartScreen 과 동일). */
const STEP_LABELS = ["아이디어", "사용자", "스택", "위치", "목표"];

// ── 조립 ────────────────────────────────────────────────────────────────

export interface BuildHomeArgs {
  projects: Project[];
  /** `null` = 백엔드 미도착/실패. 화면은 이름순으로 전부 선다 (폴백). */
  brief: HomeBrief | null;
  blueprints: ProjectBlueprint[];
  query: string;
  now: number;
  commands: CommandSpec[];
}

export function buildHome(args: BuildHomeArgs): HomeModel {
  const { projects, brief, blueprints, query, now, commands } = args;
  const since = brief?.since_workday ?? msToWorkday(now - (SPARK_DAYS - 1) * DAY_MS);

  const snapById = new Map<number, ProjectSnap>();
  for (const b of brief?.projects ?? []) {
    snapById.set(b.project_id, toSnap(b, since));
  }

  const q = query.trim();
  const searching = q.length > 0;

  // 프로젝트 행 — 검색 중이면 점수를 매기고 못 맞는 것은 버린다.
  const all: ProjectRowT[] = [];
  for (const p of projects) {
    const score = searching ? bestScore(p.name, p.root_path, q) : null;
    if (searching && score === null) continue;
    all.push({
      kind: "project",
      id: `project:${p.id}`,
      project: p,
      snap: snapById.get(p.id) ?? null,
      score,
    });
  }

  if (searching) {
    // 검색 중에는 티어가 무너진다 — 점수순 단일 목록. 동점은 마지막 활동으로.
    all.sort((a, b) => {
      if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
      return compareRecency(a, b);
    });
  } else {
    all.sort(compareRecency);
  }

  const drafts: DraftRowT[] = blueprints.map((bp) => ({
    kind: "draft",
    id: `draft:${bp.id}`,
    bp,
    stepLabel: STEP_LABELS[bp.wizard_step] ?? "초안",
  }));
  const commandRows: CommandRowT[] = commands.map((c) => ({ kind: "command", ...c }));

  let hero: ProjectRowT | null = null;
  let panels: ProjectRowT[] = [];
  let rows: ProjectRowT[] = [];
  let quiet: ProjectRowT[] = [];

  if (searching) {
    rows = all;
  } else {
    // 조용한 것은 티어 배분에서 빠져 레일 하단 색인으로 간다. 다만 **전부**
    // 조용하면(신규 사용자·백엔드 폴백) 사령탑이 비어 구도가 무너지므로,
    // 그때는 1위를 끌어올린다.
    const lively = all.filter((r) => !isQuiet(r.snap?.lastAt ?? null, now));
    const sleeping = all.filter((r) => isQuiet(r.snap?.lastAt ?? null, now));
    const pool = lively.length > 0 ? lively : all;
    const rest = lively.length > 0 ? sleeping : [];

    hero = pool[0] ?? null;
    panels = pool.slice(HERO_MAX, HERO_MAX + PANEL_MAX);
    rows = pool.slice(HERO_MAX + PANEL_MAX);
    quiet = rest;
  }

  // 커서 평면은 레일 행만. 벤토 타일은 기본 탭 순서가 담당한다 (위 주석 참고).
  const flat: HomeRow[] = [...rows, ...quiet, ...drafts, ...commandRows];
  const primary: HomeRow | null = hero ?? flat[0] ?? null;

  const matched = searching ? rows.length : all.length;
  const liveMessage = searching
    ? matched === 0
      ? `"${q}" 와 맞는 프로젝트가 없습니다. 명령을 실행할 수 있습니다.`
      : `프로젝트 ${matched}곳 검색됨`
    : "";

  return {
    hero,
    panels,
    rows,
    quiet,
    drafts,
    commands: commandRows,
    flat,
    primary,
    dateline: formatDateline(new Date(now), brief ? brief.today_total : null, projects.length),
    todayTotal: brief?.today_total ?? 0,
    liveMessage,
  };
}

/** 오늘 활동 내림차순 → 마지막 활동 내림차순 → 이름 오름차순. */
function compareRecency(a: ProjectRowT, b: ProjectRowT): number {
  const ta = a.snap?.todayCount ?? 0;
  const tb = b.snap?.todayCount ?? 0;
  if (ta !== tb) return tb - ta;

  const la = a.snap?.lastAt ?? "";
  const lb = b.snap?.lastAt ?? "";
  if (la !== lb) return lb.localeCompare(la);

  return a.project.name.localeCompare(b.project.name, "ko");
}
