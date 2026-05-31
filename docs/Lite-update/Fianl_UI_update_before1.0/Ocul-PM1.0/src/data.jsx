/* ============================================================
   Mock data — scenario: developer building "aurora-web"
   (React + TypeScript analytics dashboard) with Claude Code,
   tracked locally by Ocul-PM.
   ============================================================ */

const PROJECT = {
  name: "aurora-web",
  path: "~/dev/aurora-web",
  branch: "feat/journal-rollover",
  stack: ["React 19", "TypeScript", "Vite", "Tailwind"],
  today: "2026년 5월 31일 (일)",
  tz: "Asia/Seoul",
};

/* ---- Journal entries (newest first) ---- */
const JOURNAL = [
  {
    id: "j-014", trigger: "feature", day: "today", time: "16:42",
    agent: "Claude Code", goal: "g1",
    title: "워크데이 경계 기준 일일 롤오버 구현",
    summary:
      "자정(Asia/Seoul) 또는 사용자 지정 시각에 'Today' 집계가 자동으로 다음 워크데이로 넘어가도록 rollover 스케줄러를 추가. chrono-tz 로 타임존 경계를 계산하고, 경계를 넘긴 entry 는 어제 섹션으로 이동.",
    files: [
      { path: "src/lib/workday.ts", add: 64, del: 8 },
      { path: "src/hooks/useToday.ts", add: 22, del: 5 },
      { path: "src/lib/workday.test.ts", add: 41, del: 0 },
    ],
    tags: ["workday", "timezone"],
  },
  {
    id: "j-013", trigger: "bugfix", day: "today", time: "15:08",
    agent: "Claude Code", goal: "g1",
    title: "타임라인에서 자정 직후 entry 가 두 번 나타나던 문제 수정",
    summary:
      "경계 직전/직후 entry 의 day 키를 UTC 로 비교하던 버그. 로컬 워크데이 키로 정규화하여 중복 렌더 제거.",
    files: [
      { path: "src/components/Timeline.tsx", add: 9, del: 14 },
    ],
    tags: ["timeline"],
  },
  {
    id: "j-012", trigger: "error", day: "today", time: "14:21",
    agent: "Cursor", goal: "g1",
    title: "tree-sitter 파서 초기화 실패 → 재시도 후 복구",
    summary:
      "WASM 바이너리 로드 경로가 빌드 산출물에서 누락되어 검색 인덱싱이 3회 실패. vite assetsInclude 에 .wasm 추가 후 정상화. 실패 사이클 자동 기록됨.",
    files: [
      { path: "vite.config.ts", add: 6, del: 1 },
    ],
    tags: ["search", "build"], cycles: 3,
  },
  {
    id: "j-011", trigger: "feature", day: "today", time: "11:35",
    agent: "Claude Code", goal: "g2",
    title: "Journal 카드에 변경 파일 diff 미리보기 추가",
    summary:
      "각 카드에서 변경된 파일 수와 +/- 라인 합계를 보여주고, 클릭 시 로컬 diff 뷰로 진입하도록 연결.",
    files: [
      { path: "src/components/JournalCard.tsx", add: 38, del: 6 },
      { path: "src/components/DiffPreview.tsx", add: 52, del: 0 },
    ],
    tags: ["journal", "diff"],
  },
  {
    id: "j-010", trigger: "chore", day: "today", time: "09:50",
    agent: "Gemini CLI", goal: null,
    title: "의존성 업데이트 및 lockfile 정리",
    summary: "vite 7.0 → 7.1, recharts 패치 버전 올림. 사용하지 않는 4개 패키지 제거.",
    files: [
      { path: "package.json", add: 6, del: 9 },
      { path: "pnpm-lock.yaml", add: 120, del: 188 },
    ],
    tags: ["deps"],
  },
  {
    id: "j-009", trigger: "refactor", day: "yesterday", time: "18:02",
    agent: "Claude Code", goal: "g2",
    title: "차트 데이터 가공 로직을 selector 로 분리",
    summary:
      "Dashboard 컴포넌트 안에 흩어져 있던 집계 로직을 src/selectors 로 추출. 메모이즈 적용으로 리렌더 32% 감소.",
    files: [
      { path: "src/selectors/metrics.ts", add: 88, del: 0 },
      { path: "src/pages/Dashboard.tsx", add: 12, del: 96 },
    ],
    tags: ["perf", "chart"],
  },
  {
    id: "j-008", trigger: "feature", day: "yesterday", time: "16:18",
    agent: "Claude Code", goal: "g2",
    title: "시크릿 redaction 규칙에 Slack/GH 토큰 패턴 추가",
    summary:
      "journal 작성 시 ghp_, xoxb-, sk- 접두 토큰을 자동 마스킹. 30+ 패턴 룰셋에 4개 정규식 추가하고 테스트 케이스 보강.",
    files: [
      { path: "src/lib/redact.ts", add: 27, del: 3 },
      { path: "src/lib/redact.test.ts", add: 34, del: 0 },
    ],
    tags: ["security"],
  },
  {
    id: "j-007", trigger: "bugfix", day: "yesterday", time: "10:44",
    agent: "Cursor", goal: null,
    title: "다크 모드에서 diff 추가/삭제 색 대비 부족 수정",
    summary: "WCAG AA 기준 미달이던 diff 배경색을 토큰화하여 교체.",
    files: [{ path: "src/styles/tokens.css", add: 14, del: 6 }],
    tags: ["a11y", "diff"],
  },
];

/* ---- Today brief ---- */
const TODAY = {
  changedToday: 6,
  filesTouched: 13,
  linesAdded: 365,
  linesRemoved: 240,
  cyclesRecovered: 1,
  // activity by hour bucket (for sparkline) — entries per 2h
  activity: [0, 0, 0, 0, 3, 5, 2, 4, 6, 3, 1, 0],
  // 7-day changes
  week: [
    { d: "월", v: 9 }, { d: "화", v: 14 }, { d: "수", v: 7 },
    { d: "목", v: 18 }, { d: "금", v: 12 }, { d: "토", v: 4 }, { d: "일", v: 6 },
  ],
  highlights: ["j-014", "j-013", "j-011"],
  yesterdayDone: ["j-009", "j-008"],
  next: ["s-12", "s-13", "s-21"],
  agents: [
    { name: "Claude Code", entries: 4, color: "#d97a4f" },
    { name: "Cursor", entries: 2, color: "#5a7a95" },
    { name: "Gemini CLI", entries: 1, color: "#7c5cdb" },
  ],
};

/* ---- Planner: goal -> subtask -> entries ---- */
const PLANNER = [
  {
    id: "g1", title: "워크데이 롤오버 & Today 안정화", due: "6월 3일",
    status: "active", progress: 0.7,
    subtasks: [
      { id: "s-11", title: "타임존 경계 계산 (chrono-tz)", done: true, entries: 2 },
      { id: "s-12", title: "자정 자동 롤오버 스케줄러", done: false, entries: 1, active: true },
      { id: "s-13", title: "사용자 지정 워크데이 시작 시각 설정", done: false, entries: 0 },
      { id: "s-14", title: "롤오버 단위 테스트 통과", done: false, entries: 1 },
    ],
  },
  {
    id: "g2", title: "Journal ↔ Diff 연동 강화", due: "6월 6일",
    status: "active", progress: 0.5,
    subtasks: [
      { id: "s-21", title: "카드 diff 미리보기", done: true, entries: 1 },
      { id: "s-22", title: "로컬 diff 뷰 split/unified 토글", done: false, entries: 0, active: true },
      { id: "s-23", title: "git 없는 폴더 snapshot fallback", done: false, entries: 0 },
    ],
  },
  {
    id: "g3", title: "v1.0 출시 준비 (Lite-W6)", due: "6월 20일",
    status: "planned", progress: 0.15,
    subtasks: [
      { id: "s-31", title: "dmg / msi 번들 < 60MB 검증", done: false, entries: 0 },
      { id: "s-32", title: "온보딩 마스터 프롬프트 배포 플로우", done: false, entries: 0 },
      { id: "s-33", title: "콜드 스타트 < 1.5초 측정", done: true, entries: 1 },
    ],
  },
];

/* ---- Diff data (for j-011 JournalCard.tsx) ---- */
const DIFF_FILES = [
  { path: "src/components/JournalCard.tsx", add: 38, del: 6, status: "modified", active: true },
  { path: "src/components/DiffPreview.tsx", add: 52, del: 0, status: "added" },
  { path: "src/lib/workday.ts", add: 64, del: 8, status: "modified" },
  { path: "src/hooks/useToday.ts", add: 22, del: 5, status: "modified" },
  { path: "src/lib/workday.test.ts", add: 41, del: 0, status: "added" },
];

const DIFF_HUNKS = [
  {
    header: "@@ -18,7 +18,9 @@ export function JournalCard({ entry }: Props) {",
    lines: [
      { t: "ctx", o: 18, n: 18, x: "  const { trigger, title, summary, files } = entry;" },
      { t: "ctx", o: 19, n: 19, x: "  const meta = TRIGGER_META[trigger];" },
      { t: "ctx", o: 20, n: 20, x: "" },
      { t: "del", o: 21, n: null, x: "  const fileCount = files.length;" },
      { t: "add", o: null, n: 21, x: "  const fileCount = files.length;" },
      { t: "add", o: null, n: 22, x: "  const added = files.reduce((s, f) => s + f.add, 0);" },
      { t: "add", o: null, n: 23, x: "  const removed = files.reduce((s, f) => s + f.del, 0);" },
      { t: "ctx", o: 22, n: 24, x: "" },
      { t: "ctx", o: 23, n: 25, x: "  return (" },
    ],
  },
  {
    header: "@@ -34,6 +36,20 @@ export function JournalCard({ entry }: Props) {",
    lines: [
      { t: "ctx", o: 34, n: 36, x: "      <p className=\"summary\">{summary}</p>" },
      { t: "ctx", o: 35, n: 37, x: "" },
      { t: "del", o: 36, n: null, x: "      <span className=\"files\">{fileCount} files</span>" },
      { t: "add", o: null, n: 38, x: "      <button className=\"diff-trigger\" onClick={openDiff}>" },
      { t: "add", o: null, n: 39, x: "        <FileIcon /> {fileCount}개 파일" },
      { t: "add", o: null, n: 40, x: "        <span className=\"add\">+{added}</span>" },
      { t: "add", o: null, n: 41, x: "        <span className=\"del\">−{removed}</span>" },
      { t: "add", o: null, n: 42, x: "      </button>" },
      { t: "ctx", o: 37, n: 43, x: "    </article>" },
      { t: "ctx", o: 38, n: 44, x: "  );" },
    ],
  },
];

/* ---- Semantic search ---- */
const SEARCH_QUERY = "워크데이 경계에서 자정 롤오버 처리";
const SEARCH_RESULTS = [
  {
    path: "src/lib/workday.ts", lang: "ts", symbol: "rolloverAt()", lines: "42–58", score: 0.94,
    snippet: [
      "export function rolloverAt(now: Date, tz: string, startHour = 0) {",
      "  const local = toZonedTime(now, tz);",
      "  const boundary = startOfWorkday(local, startHour);",
      "  return now < boundary ? prevWorkday(boundary) : boundary;",
      "}",
    ],
  },
  {
    path: "src/hooks/useToday.ts", lang: "ts", symbol: "useToday()", lines: "11–24", score: 0.88,
    snippet: [
      "const key = useMemo(",
      "  () => workdayKey(now, tz, settings.startHour),",
      "  [now, tz, settings.startHour],",
      ");",
    ],
  },
  {
    path: "src/lib/workday.test.ts", lang: "ts", symbol: "describe('rollover')", lines: "3–15", score: 0.81,
    snippet: [
      "it('자정 직전 entry 는 같은 워크데이로 묶인다', () => {",
      "  const e = rolloverAt(at('23:59'), 'Asia/Seoul');",
      "  expect(key(e)).toBe('20260531');",
      "});",
    ],
  },
  {
    path: "src/components/Timeline.tsx", lang: "tsx", symbol: "groupByWorkday()", lines: "70–86", score: 0.73,
    snippet: [
      "const groups = groupBy(entries, (e) =>",
      "  workdayKey(e.createdAt, tz, startHour),",
      ");",
    ],
  },
];

/* ---- Terminal session ---- */
const TERM_LINES = [
  { k: "prompt", x: "aurora-web on  feat/journal-rollover" },
  { k: "cmd", x: "claude-code \"워크데이 자정 롤오버 구현하고 테스트 추가해줘\"" },
  { k: "dim", x: "● Reading src/lib/workday.ts, src/hooks/useToday.ts …" },
  { k: "dim", x: "● Editing src/lib/workday.ts (+64 −8)" },
  { k: "dim", x: "● Creating src/lib/workday.test.ts (+41)" },
  { k: "ok", x: "✓ 3 files changed · 5 tests added" },
  { k: "out", x: "" },
  { k: "cmd2", x: "$ pnpm test workday" },
  { k: "dim", x: " RUN  v3.0.1  ~/dev/aurora-web" },
  { k: "ok", x: " ✓ src/lib/workday.test.ts (5)" },
  { k: "ok", x: " Test Files  1 passed (1)" },
  { k: "ok", x: "      Tests  5 passed (5)" },
  { k: "journal", x: "◆ Ocul-PM  journal entry 작성됨 → .oculpm/journal/20260531/16-42-feature.md" },
];

/* ---- AI panel conversation ---- */
const AI_MODELS = [
  { id: "claude", name: "Claude Sonnet 4.5", vendor: "Anthropic", color: "#d97a4f", active: true },
  { id: "gpt", name: "GPT-5.1", vendor: "OpenAI", color: "#1aa37a" },
  { id: "gemini", name: "Gemini 2.5 Pro", vendor: "Google", color: "#4a7ad9" },
];
const AI_CHAT = [
  { role: "user", text: "오늘 워크데이 롤오버 작업 중에 자정 근처 entry 중복 버그가 있었어. 비슷한 경계 버그가 더 있을지 코드베이스에서 짚어줘." },
  {
    role: "assistant", model: "Claude Sonnet 4.5",
    text:
      "로컬 인덱스를 기준으로 보면, 같은 종류의 경계 비교가 두 군데 더 있습니다:",
    points: [
      "src/selectors/metrics.ts — 주간 집계에서 `e.createdAt.getDate()` 로 일자를 비교합니다. 타임존을 무시하므로 자정 근처에서 한 칸 어긋날 수 있습니다.",
      "src/components/Timeline.tsx:74 — `groupByWorkday()` 는 이미 `workdayKey` 를 쓰지만, 정렬 키는 여전히 UTC ISO 문자열입니다.",
    ],
    foot: "두 곳 모두 오늘 추가한 workdayKey() 로 통일하길 권합니다. 패치를 만들어 드릴까요?",
    refs: ["src/selectors/metrics.ts", "src/components/Timeline.tsx"],
  },
];

Object.assign(window, {
  PROJECT, JOURNAL, TODAY, PLANNER,
  DIFF_FILES, DIFF_HUNKS,
  SEARCH_QUERY, SEARCH_RESULTS,
  TERM_LINES, AI_MODELS, AI_CHAT,
});
