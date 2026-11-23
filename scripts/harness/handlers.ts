// 하네스 응답 — 이 저장소의 실제 .oculpm 에서 뽑은 픽스처(fixtures.mjs)를 bindings.ts 모양으로.
// 핸들러 표(`Typed`)는 키가 bindings 의 명령 이름이고 값이 그 명령의 응답이라, 모양이 어긋나면 typecheck 가 문다.
//
// URL 인자: theme=dark|light · lang=en|ko · start=1 · empty=1 · wait=1(Claude 기다림·질문) · pc=blue…(프로젝트 색)
//          fail=1(첫 계획 판정을 ✗ 로) · now=<ISO> · keep=1(저장된 화면 · 필터를 둔다)
import type { TermInfo } from "@/lib/bindings";
import { digestOf, groupChanges, summaryOf, toFileOp } from "./derive";
import type { Args, Fixtures, FixtureJournal, FixturePlan, Typed } from "./types";

const ROOT = "/Users/dev/git/ai-pm";
const DATA_DIR = "/Users/dev/Library/Application Support/com.ocul.pm";
const VERSION = "4.12.1";

type Harness = (cmd: string, a: Args) => Promise<unknown>;

export function createHandle(fx: Fixtures, qs: URLSearchParams): Harness {
  const EMPTY = qs.get("empty") === "1";
  const START = qs.get("start") === "1";
  const WAIT = qs.get("wait") === "1";
  const FAIL = qs.get("fail") === "1";
  const TODAY = fx.workdays[fx.workdays.length - 1];

  const journals: FixtureJournal[] = EMPTY ? [] : fx.journals;
  const plans: FixturePlan[] = EMPTY ? [] : (JSON.parse(JSON.stringify(fx.plans)) as FixturePlan[]);
  if (FAIL && plans[0]) {
    plans[0].summary.last_verdict = {
      passed: false,
      summary: "Tests  2 failed | 1966 passed (1968)",
      ts: fx.nowIso,
      agent_id: "claude-code",
      item_id: plans[0].items[0]?.item_id ?? "x",
      passed_here_at: null,
    };
  }
  const changes = EMPTY ? [] : fx.changes;
  const patches = fx.patches;
  const unrecorded = EMPTY ? [] : fx.unrecorded;

  const norm = (p: unknown) => String(p).replace(/^\.oculpm\/journal\//, "");
  const findJ = (p: unknown) => journals.find((j) => j.relative_path === norm(p));

  type Filters = null | { types?: string[]; search?: string | null; unverified_only?: boolean; verified_only?: boolean };
  function filterJournals(a: Args): FixtureJournal[] {
    let list = journals;
    if (a.workday) list = list.filter((j) => j.workday === a.workday);
    const f = (a.filters ?? null) as Filters;
    if (f?.types?.length) list = list.filter((j) => f.types!.includes(j.type));
    if (f?.search) list = list.filter((j) => (j.title + j.body_markdown).includes(f.search!));
    if (f?.unverified_only) list = list.filter((j) => !j.verified_by_user);
    if (f?.verified_only) list = list.filter((j) => j.verified_by_user);
    return list;
  }

  const projects = [
    { id: 1, name: "ai-pm", root_path: ROOT, created_at: 1751000000, icon: null, color: qs.get("pc") ?? null },
    { id: 2, name: "receipt-cli", root_path: "/Users/dev/git/receipt-cli", created_at: 1752000000, icon: null, color: "blue" },
    { id: 3, name: "landing-kit", root_path: "/Users/dev/git/landing-kit", created_at: 1753000000, icon: null, color: null },
    { id: 4, name: "dotfiles", root_path: "/Users/dev/dotfiles", created_at: 1754000000, icon: null, color: null },
  ];

  const sessionsToday = [
    {
      id: `${TODAY}-002`,
      started_at: fx.nowIso.slice(0, 11) + "07:20:00+09:00",
      ended_at: null,
      ended_reason: null,
      active_window_ms: 3_600_000,
      file_event_count: 120,
      files_unique: 40,
      git_head_at_start: "28077f31",
      git_head_at_end: null,
      agent_label_guess: "claude-code",
      agent_sessions: [],
      linked_journal_entries: journals.filter((j) => j.workday === TODAY).map((j) => j.relative_path),
    },
  ];

  let termId = 0;
  const termSessions: TermInfo[] = [];

  const typed: Typed = {
    // ---- 설정 · 앱
    settings_get_all: () => {
      const s: [string, string][] = [["tour_seen", "1"]];
      if (qs.get("theme")) s.push(["theme", qs.get("theme")!]);
      if (qs.get("lang")) s.push(["language", qs.get("lang")!]);
      if (qs.get("accent")) s.push(["color_theme", qs.get("accent")!]);
      return s;
    },
    settings_set: () => null,
    settings_set_many: () => null,
    app_info: () => ({ db_path: `${DATA_DIR}/ocul-pm.db`, app_data_dir: DATA_DIR, version: VERSION }),
    install_kind: () => ({ os: "darwin", arch: "aarch64", bundle_type: "app", updater_targets: ["darwin-aarch64-app", "darwin-aarch64"] }),
    update_check_claim: () => false,
    update_check_report: () => undefined,
    oculpm_log: () => undefined,
    apply_menu_language: () => null,
    save_window_session: () => null,
    db_health: () => ({
      sqlite_version: "3.53.0",
      vec_version: "v0.1.6",
      schema_version: 47,
      path: `${DATA_DIR}/ocul-pm.db`,
      db_bytes: 48_000_000,
      wal_bytes: 1_200_000,
      free_bytes: 2_000_000,
      top_tables: [{ name: "oculpm_journal", bytes: 21_000_000 }],
    }),
    detect_editor: () => "code",
    oculpm_get_log_dir: () => "/Users/dev/Library/Logs/com.ocul.pm",

    // ---- 창 · 프로젝트
    get_window_project: () => (START ? null : 1),
    list_projects: () => projects,
    list_open_project_ids: () => (START ? [] : [1]),
    recent_window_projects: () => (START ? [] : [1]),
    project_attention: (a) =>
      ((a.projectIds as number[]) ?? []).map((id) => ({ project_id: id, waiting: WAIT && id === 1 ? 1 : 0, failing: FAIL && id === 1 })),
    set_window_project: () => true,
    sync_project_color: () => true,
    home_brief: () => {
      const today = journals.filter((j) => j.workday === TODAY);
      return {
        projects: projects.map((p) => ({
          project_id: p.id,
          total_entries: p.id === 1 ? journals.length : [0, 0, 31, 7, 2][p.id],
          last_at: p.id === 1 ? (journals[0]?.created_at ?? null) : "2026-11-12T10:00:00+09:00",
          last_workday: p.id === 1 ? (journals[0]?.workday ?? null) : "20261112",
          last_title: p.id === 1 ? (journals[0]?.title ?? null) : "CLI: 영수증 출력에 --json 을 더했다",
          last_type: p.id === 1 ? (journals[0]?.type ?? null) : "feature",
          last_agent_id: "claude-code",
          last_agent_version: "Opus 5.5",
          today_count: p.id === 1 ? today.length : 0,
          days: fx.workdays.map((w) => ({ workday: w, count: p.id === 1 ? journals.filter((j) => j.workday === w).length : 0 })),
          next_tasks: [],
          active_plan:
            p.id === 1 && plans[0]
              ? { plan_id: plans[0].summary.plan_id, plan_title: plans[0].summary.title, progress: plans[0].summary.progress, done: plans[0].summary.done_count, total: plans[0].summary.item_count }
              : null,
          identity: null,
        })),
        today_workday: TODAY,
        since_workday: fx.workdays[0],
        today_total: today.length,
        active_projects: 2,
        feed: journals.slice(0, 12).map((j) => ({
          project_id: 1,
          relative_path: j.relative_path,
          workday: j.workday,
          created_at: j.created_at,
          title: j.title,
          type: j.type,
          agent_id: j.agent_id,
          agent_version: j.agent_version,
        })),
      };
    },

    // ---- .oculpm 수명
    oculpm_init: () => ({ created_dirs: [], wrote_config: false, wrote_gitignore: false, lock_state: "healthy", agent_files: [] }),
    oculpm_get_status: () => ({
      initialized: true,
      config_valid: true,
      lock_state: "healthy",
      current_workday: TODAY,
      watcher_state: "running",
      watcher_dropped_total: 0,
      watcher_user_paused: false,
    }),
    oculpm_watcher_start: () => null,
    oculpm_watcher_stop: () => null,
    oculpm_watcher_take_over: () => null,
    oculpm_get_config: () => ({
      schema_version: 1,
      project_color: qs.get("pc") ?? null,
      workday: { timezone: "Asia/Seoul", day_starts_at: "04:00" },
      session: { inactivity_timeout_minutes: 30, session_resume_grace_minutes: 10 },
      git: { forbid_journal_for_paths: [], auto_redact_patterns: [] },
      watcher: { ignore: ["node_modules", "target"], respect_gitignore: true, debounce_ms: 300, responsiveness: null },
      agents: { active: ["claude-code", "codex"], rules_translate: [], template_language: "ko" },
    }),
    oculpm_set_config: () => null,
    oculpm_agents_detect: () => [
      { agent_id: "claude-code", confidence: "present", adapter_path_exists: true, adjacent_marker_exists: true },
      { agent_id: "codex", confidence: "likely", adapter_path_exists: true, adjacent_marker_exists: false },
    ],
    oculpm_agents_check_master_ahead: () => null,
    oculpm_agents_check_master_upgrade: () => null,
    oculpm_agents_sync_active: () => ({ results: [] }),
    oculpm_agents_apply_master_upgrade: () => ({ results: [] }),

    // ---- 세션
    oculpm_current_session: () => (EMPTY ? null : sessionsToday[0]),
    oculpm_list_sessions: () => (EMPTY ? [] : sessionsToday),
    oculpm_get_file_changes: () => [],
    oculpm_compare_workday: (a) => ({
      workday: String(a.workday ?? TODAY),
      sessions:
        EMPTY || a.projectId !== 1 || !unrecorded.length
          ? []
          : [{ session_id: `${TODAY}-002`, unrecorded, unrecorded_severity: "warning" }],
      unrecorded_total: EMPTY || a.projectId !== 1 ? 0 : unrecorded.length,
    }),

    // ---- 일지
    oculpm_list_journal_entries: (a) => filterJournals(a).map(summaryOf),
    oculpm_list_journal_entries_page: (a) => {
      const list = filterJournals(a);
      const off = (a.offset as number) ?? 0;
      const lim = (a.limit as number) ?? 200;
      return { entries: list.slice(off, off + lim).map(summaryOf), total: list.length };
    },
    oculpm_get_journal_entry: (a) => {
      const j = findJ(a.relativePath);
      if (!j) return null;
      return {
        relative_path: j.relative_path,
        frontmatter: {
          schema_version: 1,
          type: j.type,
          slug: j.slug,
          status: j.status,
          difficulty: j.difficulty,
          created_at: j.created_at,
          updated_at: j.updated_at,
          session_id: j.session_id,
          agent: { id: j.agent_id, version: j.agent_version, session: j.agent_session },
          language: j.language,
          verified_by_user: j.verified_by_user,
          verified_hash: null,
          files_touched: j.files.map((f) => ({ path: f.path, op: toFileOp(f.op), bytes_added: null, bytes_removed: null, rename_from: null })),
          related: j.related,
          tags: j.tags,
        },
        title: j.title,
        checkbox: j.checkbox,
        body_markdown: j.body_markdown,
        byte_size: j.byte_size,
        mtime: j.updated_at ?? j.created_at,
        parse_ok: true,
        parse_warnings: [],
        verified_stale: false,
        evidence: j.evidence,
      };
    },
    oculpm_get_entry_diffs: (a) => {
      const j = findJ(a.relativePath);
      if (!j) return [];
      return j.files.filter((f) => patches[f.path]).map((f) => ({ path: f.path, patch: patches[f.path] }));
    },
    oculpm_suggest_related: () => [],
    oculpm_workday_brief: (a) => {
      const days = ((a.workdays as string[]) ?? []).map((w) => ({ workday: w, entries: journals.filter((j) => j.workday === w).map(summaryOf) }));
      return { days, lines_added: 820, lines_removed: 312, files_touched: 64, open_plan_items: [], total_entries: days.reduce((n, d) => n + d.entries.length, 0) };
    },
    oculpm_search_journal: (a) => {
      const q = String(a.query ?? "");
      const hits = journals
        .filter((j) => (j.title + j.body_markdown).includes(q))
        .slice(0, (a.limit as number) ?? 50)
        .map((j) => ({
          relative_path: j.relative_path,
          workday: j.workday,
          entry_type: j.type,
          status: j.status,
          title: j.title,
          snippet: j.body_markdown.slice(0, 120),
          matched_field: "body",
          why: "body",
          score: null,
        }));
      return { hits, total: hits.length };
    },
    oculpm_search_entities: (a) => {
      const q = String(a.query ?? "");
      const js = journals
        .filter((j) => j.title.includes(q))
        .slice(0, 8)
        .map((j) => ({ kind: "journal" as const, id: j.relative_path, title: j.title, subtitle: j.workday }));
      const ps = plans
        .filter((p) => p.summary.title.includes(q))
        .map((p) => ({ kind: "plan" as const, id: p.summary.plan_id, title: p.summary.title, subtitle: "" }));
      return [...ps, ...js];
    },
    oculpm_gone_journals: () => [],
    oculpm_tag_stats: () => {
      const m = new Map<string, { count: number; last: string }>();
      for (const j of journals) for (const t of j.tags) m.set(t, { count: (m.get(t)?.count ?? 0) + 1, last: j.workday });
      return [...m].map(([tag, v]) => ({ tag, count: v.count, last_workday: v.last, suggest_into: null }));
    },
    oculpm_file_hotspots: () => [],
    oculpm_velocity: () => ({ weeks: [], plan: { open_items: 12, done_last_4w: 40, weekly_done_avg: 10, eta_weeks: 1.2, note: null } }),
    oculpm_promise_scorecard: () => ({
      window_days: 30,
      journal: { judged_entries: 120, evidence_entries: 104, bug_entries: 30, rework_within_7d: 11, hub_cut: 0 },
      plans: { active_plans: plans.length, with_done_when: plans.length, with_check: Math.max(plans.length - 1, 0) },
    }),
    oculpm_set_journal_verified: () => null,
    oculpm_set_journal_verified_bulk: () => ({ updated: 0, skipped: [] }),
    journal_missing_signals: () => [],
    oculpm_group_changes: (a) => groupChanges(journals, unrecorded, (a.paths as string[]) ?? []),

    // ---- Claude 연동
    claude_waiting: () =>
      WAIT ? [{ session_id: `${TODAY}-002`, kind: "permission", message: "Bash(pnpm test) 를 돌려도 될까요?", since: fx.nowIso }] : [],
    claude_questions: () =>
      WAIT
        ? [{ id: "q1", question: "변경 화면 메모 판정 낱말을 「반영됨/아직」 으로 바꿀까요?", options: ["바꿔요", "그대로 둬요"], asked_at: fx.nowIso }]
        : [],
    claude_blocked: () => [],
    agent_link_health:() => ({ claude_seen: true, hook_last_at: new Date().toISOString() }),
    mcp_status: () => ({
      registered: true,
      binary_found: true,
      binary_path: "/Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp",
      mcp_json_path: `${ROOT}/.mcp.json`,
      foreign_servers: 0,
    }),
    agent_mcp_status: (a) => ({
      target: (a.target as "cursor" | "gemini") ?? "cursor",
      detected: a.target === "cursor",
      registered: false,
      binary_found: true,
      binary_path: "/Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp",
      config_path: `${ROOT}/.${String(a.target ?? "cursor")}/mcp.json`,
    }),
    claude_plugin_status: () => ({
      state: "connected",
      installed: true,
      path: "/Users/dev/.claude/plugins/oculpm",
      installed_version: VERSION,
      scope: "user",
      bundled_version: VERSION,
      behind: false,
      ahead: false,
      other_behind: 0,
      app_reachable: true,
    }),
    codex_mcp_status: () => ({
      installed: true,
      registered: false,
      binary_found: true,
      binary_path: "/opt/homebrew/bin/codex",
      config_path: "/Users/dev/.codex/config.toml",
      server_key: "oculpm",
      pinned_root: null,
      foreign_servers: 1,
    }),
    codex_plugin_status: () => ({
      codex_installed: true,
      enabled: false,
      marketplace: null,
      marketplace_configured: false,
      cached_version: null,
      config_path: "/Users/dev/.codex/config.toml",
    }),
    claude_theme_write: () => ({ state: "unchanged", path: "/Users/dev/.claude/themes/ocul.json" }),

    // ---- 계획
    plan_list: () => plans.map((p) => p.summary),
    plan_get: (a) => {
      const p = plans.find((x) => x.summary.plan_id === a.planId);
      if (!p) return null;
      return { plan: p.summary, items: p.items, phases: p.phases, decisions: p.decisions, warnings: p.warnings, done_when: p.done_when, check: p.check };
    },
    plan_log: (a) => plans.find((p) => p.summary.plan_id === a.planId)?.log ?? [],
    plan_locked_open: () => [],
    plan_dispatch_prompt: () => ({ file_rel: ".oculpm/planner/x.md", command: "claude", prompt: "/oculpm:next", item_title: "x" }),
    today_digest: () => digestOf(plans),
    today_arrived: () => null,
    today_local_only: () => ({ uncommitted: changes.length, records: 0, unpushed: 3, unpushed_records: 2 }),
    today_teammates: () => [],

    // ---- git · diff
    git_status: () => ({ is_git_repo: true, git_missing: false, head_branch: "main", remotes: [] }),
    git_log: () => [],
    git_uncommitted_changes: () => changes,
    git_last_commit_changes: () =>
      EMPTY ? null : { sha: "0fb53391aa", short_sha: "0fb53391", subject: "chore(journal): 마지막 커밋", changes: [{ path: changes[0]?.path ?? "README.md", op: "M" }] },
    compute_diff: (a) => {
      const p = String(a.path);
      const patch = patches[p];
      if (!patch) return { path: p, source: { source: "snapshots_unavailable" }, truncated: null };
      return { path: p, source: { source: "git", patch }, truncated: null };
    },
    diff_generated_files: () => [],
    diff_receipt: () => ({
      branch: "main",
      base_label: "origin/main",
      commits: 3,
      files: changes.length,
      journals: journals.slice(0, 3).map((j) => ({ path: j.relative_path, title: j.title, kind: j.type, evidence: j.evidence, proof: null })),
      unrecorded,
    }),
    save_receipt_html: () => null,
    race_lanes: () => [],
    read_project_file: () => "",

    // ---- 터미널
    term_list: () => termSessions,
    term_overview: () => termSessions,
    term_take_resume: () => [],
    term_busy_all: () => ({ busy: 0, claude: 0 }),
    term_open: (a) => {
      termId += 1;
      const info: TermInfo = {
        id: termId,
        project_id: 1,
        label: "zsh",
        started_at: new Date().toISOString(),
        alive: true,
        exit_code: null,
        status: null,
        busy: false,
        unseen: false,
        title: null,
      };
      termSessions.push(info);
      const ch = a.onEvent as { id: number } | undefined;
      const run = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, d: unknown) => void } }).__TAURI_INTERNALS__.runCallback;
      if (ch?.id != null) {
        const text = "Last login: Sun Nov 15 18:19:02 on ttys004\r\n\x1b[1mdev@mac\x1b[0m ai-pm % ";
        setTimeout(() => run(ch.id, { message: { kind: "output", data: text, n: text.length }, index: 0 }), 300);
      }
      return info;
    },
    term_write: () => null,
    term_ack: () => undefined,
    term_resize: () => null,
    term_close: () => undefined,
    term_end_window: () => undefined,
  };

  const table = typed as Record<string, ((a: Args) => unknown) | undefined>;
  return async (cmd, a) => {
    const fn = table[cmd];
    if (fn) return fn(a);
    if (cmd.startsWith("plugin:")) return plugin(cmd, qs);
    return missing(cmd);
  };
}


function missing(cmd: string): null {
  const w = window as unknown as { __ipcMissing: Record<string, number> };
  w.__ipcMissing[cmd] = (w.__ipcMissing[cmd] ?? 0) + 1;
  return null;
}

/** Tauri 플러그인(`plugin:` 접두)의 명령 — 창 · 앱 · 알림 · 업데이터. 모르는 것은 누락으로 센다. */
function plugin(cmd: string, qs: URLSearchParams): unknown {
  if (cmd === "plugin:app|version") return VERSION;
  if (cmd === "plugin:app|name") return "Ocul";
  if (cmd === "plugin:app|tauri_version") return "2.12.4";
  if (cmd.endsWith("|is_maximized") || cmd.endsWith("|is_fullscreen") || cmd.endsWith("|is_minimized")) return false;
  if (cmd.endsWith("|is_focused")) return true;
  if (cmd.endsWith("|is_visible")) return true;
  if (cmd.endsWith("|scale_factor")) return 2;
  if (cmd.endsWith("|theme")) return qs.get("theme") === "dark" ? "dark" : "light";
  if (cmd.endsWith("|inner_size") || cmd.endsWith("|outer_size")) return { width: innerWidth * 2, height: innerHeight * 2 };
  if (cmd === "plugin:notification|is_permission_granted") return true;
  if (cmd === "plugin:updater|check") return null;
  if (cmd === "plugin:webview|set_webview_zoom") return null;
  return missing(cmd);
}
