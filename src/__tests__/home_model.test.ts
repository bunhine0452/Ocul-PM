/**
 * 메인 화면 모델 — 순수 함수 계약.
 *
 * 이 화면은 "3초 안에 어디서 이어서 일할지"에 답하는 것이 목적이라, 랭킹과
 * 티어 분류가 제품의 핵심이다. 경계(오늘 활동 동률, 14일 조용 기준, 창 밖
 * 마지막 활동)를 여기서 고정한다.
 */
import { describe, expect, it } from "vitest";
import {
  buildHome,
  formatDateline,
  hhmm,
  initials,
  isQuiet,
  QUIET_DAYS,
  relativeTime,
  sparkSeries,
  tildePath,
} from "@/features/onboarding/home/homeModel";
import type { HomeBrief, Project } from "@/lib/bindings";

const NOW = new Date("2026-07-31T14:00:00+09:00").getTime();

function project(id: number, name: string, root = `/Users/me/git/${name}`): Project {
  return { id, name, root_path: root, created_at: 0 };
}

function brief(over: Partial<HomeBrief> = {}): HomeBrief {
  return {
    projects: [],
    today_workday: "20260731",
    since_workday: "20260718",
    today_total: 0,
    active_projects: 0,
    feed: [],
    ...over,
  } as HomeBrief;
}

function pb(id: number, over: Record<string, unknown> = {}) {
  return {
    project_id: id,
    total_entries: 0,
    last_at: null,
    last_workday: null,
    last_title: null,
    last_type: null,
    last_agent_id: null,
    last_agent_version: null,
    today_count: 0,
    days: [],
    next_tasks: [],
    active_plan: null,
    identity: null,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("relativeTime", () => {
  it("분·시간·일 단위로 접는다", () => {
    expect(relativeTime("2026-07-31T13:59:30+09:00", NOW)).toBe("방금 전");
    expect(relativeTime("2026-07-31T13:30:00+09:00", NOW)).toBe("30분 전");
    expect(relativeTime("2026-07-31T11:00:00+09:00", NOW)).toBe("3시간 전");
    expect(relativeTime("2026-07-29T14:00:00+09:00", NOW)).toBe("2일 전");
  });

  it("기록이 없으면 대시 (거짓 시각을 만들지 않는다)", () => {
    expect(relativeTime(null, NOW)).toBe("—");
  });
});

describe("hhmm", () => {
  it("ISO 에서 시:분만 뽑는다", () => {
    expect(hhmm("2026-07-31T14:22:05+09:00")).toBe("14:22");
  });
  it("형식이 어긋나면 빈 문자열", () => {
    expect(hhmm("garbage")).toBe("");
  });
});

describe("tildePath", () => {
  it("홈 디렉터리를 ~ 로 접는다", () => {
    expect(tildePath("/Users/kimhyunbin/Desktop/git/ai-pm")).toBe("~/Desktop/git/ai-pm");
    expect(tildePath("/home/kim/lab/x")).toBe("~/lab/x");
  });
  it("홈 밖 경로는 그대로 둔다", () => {
    expect(tildePath("/opt/work/x")).toBe("/opt/work/x");
  });
});

describe("initials", () => {
  it("최대 2글자", () => {
    expect(initials("aurora-web")).toBe("AW");
    expect(initials("ai-pm")).toBe("AP");
    expect(initials("PySpace")).toBe("PY");
    expect(initials("회고")).toBe("회");
  });
  it("빈 이름은 빈 문자열", () => {
    expect(initials("")).toBe("");
  });
});

describe("sparkSeries", () => {
  it("희소 버킷을 창 길이로 0 패딩하고 과거→오늘 순서로 만든다", () => {
    const s = sparkSeries([{ workday: "20260731", count: 3 }], "20260718", 14);
    expect(s).toHaveLength(14);
    expect(s[13]).toBe(3); // 마지막 칸 = 오늘
    expect(s.slice(0, 13).every((n) => n === 0)).toBe(true);
  });

  it("창 밖 버킷은 무시한다", () => {
    const s = sparkSeries([{ workday: "20260101", count: 9 }], "20260718", 14);
    expect(s.every((n) => n === 0)).toBe(true);
  });

  it("버킷이 없으면 전부 0 (길이는 유지 — 형태가 무너지면 안 된다)", () => {
    expect(sparkSeries([], "20260718", 14)).toEqual(new Array(14).fill(0));
  });
});

describe("isQuiet", () => {
  it("14일 이상 활동이 없으면 조용한 프로젝트", () => {
    const quietAt = new Date(NOW - (QUIET_DAYS + 1) * 86400_000).toISOString();
    expect(isQuiet(quietAt, NOW)).toBe(true);
  });

  it("13일 전은 아직 조용하지 않다 (경계)", () => {
    const recent = new Date(NOW - (QUIET_DAYS - 1) * 86400_000).toISOString();
    expect(isQuiet(recent, NOW)).toBe(false);
  });

  it("기록이 아예 없으면 조용한 쪽으로 (레일 하단 색인으로 접는다)", () => {
    expect(isQuiet(null, NOW)).toBe(true);
  });
});

describe("formatDateline", () => {
  it("날짜 + 오늘 건수 + 프로젝트 수", () => {
    const line = formatDateline(new Date("2026-07-31T09:00:00+09:00"), 12, 10);
    expect(line).toContain("2026년 7월 31일");
    expect(line).toContain("금요일");
    expect(line).toContain("오늘 12건");
    expect(line).toContain("프로젝트 10");
  });

  it("아직 집계 전이면 건수 절을 생략한다 (0건이라고 단정하지 않는다)", () => {
    const line = formatDateline(new Date("2026-07-31T09:00:00+09:00"), null, 10);
    expect(line).not.toContain("오늘");
    expect(line).toContain("프로젝트 10");
  });
});

describe("buildHome — 랭킹과 티어", () => {
  const projects = [
    project(1, "alpha"),
    project(2, "bravo"),
    project(3, "charlie"),
    project(4, "delta"),
    project(5, "echo"),
  ];

  it("오늘 활동이 가장 많은 프로젝트가 사령탑", () => {
    const m = buildHome({
      projects,
      brief: brief({
        projects: [
          pb(1, { today_count: 1, last_at: "2026-07-31T09:00:00+09:00" }),
          pb(3, { today_count: 5, last_at: "2026-07-31T10:00:00+09:00" }),
        ],
      }),
      blueprints: [],
      query: "",
      now: NOW,
      commands: [],
    });
    expect(m.hero?.project.name).toBe("charlie");
  });

  it("오늘 동률이면 마지막 활동이 최근인 쪽이 앞", () => {
    const m = buildHome({
      projects,
      brief: brief({
        projects: [
          pb(1, { today_count: 2, last_at: "2026-07-31T09:00:00+09:00" }),
          pb(2, { today_count: 2, last_at: "2026-07-31T13:00:00+09:00" }),
        ],
      }),
      blueprints: [],
      query: "",
      now: NOW,
      commands: [],
    });
    expect(m.hero?.project.name).toBe("bravo");
  });

  it("사령탑 1 · 판 2 · 나머지 행, 14일 이상 조용한 것은 색인으로", () => {
    const recent = "2026-07-30T10:00:00+09:00";
    const old = "2026-06-01T10:00:00+09:00";
    const m = buildHome({
      projects,
      brief: brief({
        projects: [
          pb(1, { today_count: 3, last_at: recent }),
          pb(2, { last_at: recent }),
          pb(3, { last_at: recent }),
          pb(4, { last_at: recent }),
          pb(5, { last_at: old }),
        ],
      }),
      blueprints: [],
      query: "",
      now: NOW,
      commands: [],
    });
    expect(m.hero?.project.name).toBe("alpha");
    expect(m.panels).toHaveLength(2);
    expect(m.rows).toHaveLength(1);
    expect(m.quiet.map((r) => r.project.name)).toEqual(["echo"]);
  });

  it("brief 가 없어도(백엔드 실패) 이름순으로 전부 선다", () => {
    const m = buildHome({
      projects,
      brief: null,
      blueprints: [],
      query: "",
      now: NOW,
      commands: [],
    });
    // 기록이 없으면 전부 조용한 쪽 — 다만 사령탑은 비우지 않는다.
    expect(m.hero?.project.name).toBe("alpha");
    expect(m.hero!.snap).toBeNull();
    const all = [m.hero!, ...m.panels, ...m.rows, ...m.quiet];
    expect(all).toHaveLength(5);
  });

  it("검색 중이면 티어가 무너지고 점수순 단일 목록이 된다", () => {
    const m = buildHome({
      projects,
      brief: brief({ projects: [pb(1, { today_count: 9, last_at: "2026-07-31T09:00:00+09:00" })] }),
      blueprints: [],
      query: "ch",
      now: NOW,
      commands: [],
    });
    expect(m.hero).toBeNull();
    expect(m.panels).toEqual([]);
    expect(m.quiet).toEqual([]);
    // charlie 는 접두(100), echo 는 퍼지 부분수열(e-CH-o). 둘 다 결과에 남되
    // 접두가 반드시 앞선다 — "타이핑 후 ⏎" 가 의도한 프로젝트를 열어야 한다.
    expect(m.rows[0].project.name).toBe("charlie");
    expect(m.rows.map((r) => r.project.name)).toContain("echo");
    expect(m.rows[0].score!).toBeGreaterThan(m.rows[1].score!);
  });

  it("검색은 명령 행도 거른다 — 그래도 결과 0이면 명령이 남아 ⏎ 가 살아 있다", () => {
    const cmds = [
      { id: "cmd:add", label: "기존 폴더 불러오기", hint: "⌘O", run: () => {} },
      { id: "cmd:new", label: "새 프로젝트 시작하기", hint: "⌘N", run: () => {} },
    ];
    const m = buildHome({
      projects,
      brief: brief(),
      blueprints: [],
      query: "zzzz",
      now: NOW,
      commands: cmds,
    });
    expect(m.rows).toEqual([]);
    expect(m.commands.length).toBeGreaterThan(0);
    expect(m.flat.length).toBeGreaterThan(0);
  });

  it("flat 은 시각 순서와 같다 — hero → panels → rows → quiet → drafts → commands", () => {
    const recent = "2026-07-30T10:00:00+09:00";
    const m = buildHome({
      projects: [project(1, "alpha"), project(2, "bravo"), project(3, "charlie"), project(4, "delta")],
      brief: brief({
        projects: [
          pb(1, { today_count: 3, last_at: recent }),
          pb(2, { last_at: recent }),
          pb(3, { last_at: recent }),
          pb(4, { last_at: "2026-06-01T10:00:00+09:00" }),
        ],
      }),
      blueprints: [
        {
          id: 9,
          name: "사내 위키",
          idea_text: null,
          target_users: null,
          stack_choice: null,
          folder_name: null,
          folder_path: null,
          seed_goals_json: null,
          wizard_step: 2,
          created_at: 0,
          updated_at: 0,
        },
      ],
      query: "",
      now: NOW,
      commands: [{ id: "cmd:add", label: "기존 폴더 불러오기", hint: "⌘O", run: () => {} }],
    });

    // flat 은 **레일 행만** 담는다 — 벤토 타일(hero/panels)은 커서 평면에
    // 들어가지 않는다. 타일이 여기 섞이면 flat[0] 이 커서에 등록되지 않은
    // 요소를 가리켜 레일의 탭 스톱이 0개가 되고 ↓/↑/Home 이 전부 죽는다.
    const kinds = m.flat.map((r) => r.kind);
    expect(kinds).toEqual(["project", "draft", "command"]);
    // hero(alpha)·panels(bravo, charlie)는 제외, quiet(delta)만 레일에 남는다.
    expect(m.flat[0].kind === "project" && m.flat[0].project.name).toBe("delta");
    expect(m.hero?.project.name).toBe("alpha");

    // ⏎ 는 사령탑을 연다 (flat[0] 이 아니다).
    expect(m.primary).toBe(m.hero);
  });

  it("검색 중에는 primary 가 1위 결과 — flat[0] 과 같아진다", () => {
    const m = buildHome({
      projects,
      brief: brief(),
      blueprints: [],
      query: "charlie",
      now: NOW,
      commands: [],
    });
    expect(m.hero).toBeNull();
    expect(m.primary).toBe(m.flat[0]);
    expect(m.primary!.kind === "project" && m.primary!.project.name).toBe("charlie");
  });

  it("벤토 타일은 flat 에 절대 들어가지 않는다 (커서 사망 회귀 방지)", () => {
    const recent = "2026-07-30T10:00:00+09:00";
    const m = buildHome({
      projects,
      brief: brief({
        projects: [
          pb(1, { today_count: 3, last_at: recent }),
          pb(2, { last_at: recent }),
          pb(3, { last_at: recent }),
        ],
      }),
      blueprints: [],
      query: "",
      now: NOW,
      commands: [],
    });
    const tileIds = [m.hero!.id, ...m.panels.map((p) => p.id)];
    for (const id of tileIds) {
      expect(m.flat.some((r) => r.id === id)).toBe(false);
    }
  });

  it("오늘 총계와 데이트라인은 brief 를 따른다", () => {
    const m = buildHome({
      projects,
      brief: brief({ today_total: 12 }),
      blueprints: [],
      query: "",
      now: NOW,
      commands: [],
    });
    expect(m.todayTotal).toBe(12);
    expect(m.dateline).toContain("오늘 12건");
  });
});
