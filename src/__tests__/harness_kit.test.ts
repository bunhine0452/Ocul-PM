import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createHandle } from "../../scripts/harness/handlers";
import type { Fixtures } from "../../scripts/harness/types";

// 화면 하네스(scripts/harness)를 문다 — 개발 도구가 (1) 앱 번들에 새지 않고 (2) 픽스처에 이 기기의 이름 ·
// 시크릿을 박지 않고 (3) 가짜 결함(탭 배지 2 인데 변경 화면엔 일지 없음 묶음이 없는 어긋남)을 내지 않는다.
// 하네스 코드를 지우거나 규칙을 되돌리면 아래가 붉어진다.

const ROOT = process.cwd();
const FIXTURES_SCRIPT = resolvePath(ROOT, "scripts/harness/fixtures.mjs");
const read = (rel: string) => readFileSync(resolvePath(ROOT, rel), "utf8");

const tmp = mkdtempSync(join(tmpdir(), "harness-kit-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function git(repo: string, ...args: string[]) {
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { stdio: "ignore" });
}

describe("fixtures.mjs draws from the repo .oculpm and scrubs private data and secrets", () => {
  // 되돌리면 깨진다: SCRUBBERS 의 키 · 이메일 · 집 폴더 규칙 지우기, 「일지에 안 적힌 파일」 계산 지우기.
  const repo = join(tmp, "repo");
  const home = join(tmp, "someuser");
  const out = join(tmp, "fixtures.json");
  const secret = "sk-abcdefghijklmnopqrstuvwxyz0123";

  function run() {
    mkdirSync(join(repo, ".oculpm/journal/20261120/Features_to_add"), { recursive: true });
    mkdirSync(join(repo, ".oculpm/planner"), { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    execFileSync("git", ["-C", repo, "init", "-q"], { stdio: "ignore" });
    writeFileSync(join(repo, "src/a.ts"), "export const a = 1;\n");
    writeFileSync(join(repo, "src/b.ts"), "export const b = 2;\n");
    git(repo, "add", "--", "src/a.ts", "src/b.ts");
    git(repo, "commit", "-q", "-m", "init");
    writeFileSync(
      join(repo, ".oculpm/journal/20261120/Features_to_add/1000_feature_demo.md"),
      [
        "---",
        "type: feature",
        "slug: demo",
        "status: done",
        'created_at: "2026-11-20T10:00:00+09:00"',
        "session_id: 20261120-001",
        "agent:",
        "  id: claude-code",
        "files_touched:",
        "  - path: src/a.ts",
        "    op: update",
        "tags: []",
        "related: []",
        "---",
        "[x] Demo title",
        "",
        "## Verification",
        "pnpm test exit 0",
        `key ${secret} at ${home}/work and /Users/someone/x, mail me@corp.io`,
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(repo, ".oculpm/planner/demo.md"),
      ["---", "id: demo", "title: Demo plan", "status: active", "owner: claude-code", "---", "## Phase A", "- [ ] First {#first}", ""].join("\n"),
    );
    mkdirSync(home, { recursive: true });
    execFileSync(process.execPath, [FIXTURES_SCRIPT, "--repo", repo, "--out", out], { env: { ...process.env, HOME: home }, stdio: "ignore" });
    return JSON.parse(readFileSync(out, "utf8")) as Fixtures;
  }
  const fx = run();
  const raw = readFileSync(out, "utf8");

  it("extracts journals and plans and grades evidence from the verification section", () => {
    expect(fx.journals).toHaveLength(1);
    expect(fx.journals[0].title).toBe("Demo title");
    expect(fx.journals[0].checkbox).toBe(true);
    expect(fx.journals[0].evidence).toBe(2);
    expect(fx.plans[0].summary.plan_id).toBe("demo");
    expect(fx.plans[0].items[0]).toMatchObject({ item_id: "first", phase: "Phase A", status: "todo" });
  });

  it("leaves no key shape, email or home folder name in the fixtures", () => {
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("me@corp.io");
    expect(raw).not.toContain("someuser");
    expect(raw).not.toContain("/Users/someone");
    expect(fx.journals[0].body_markdown).toContain("/Users/dev/work");
  });

  it("marks only changes no journal lists as unrecorded, and keeps them in the change list", () => {
    expect(fx.unrecorded).toEqual(["src/b.ts"]);
    expect(fx.changes.map((c) => c.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(fx.patches["src/b.ts"]).toContain("export const b");
  });
});

describe("handlers.ts — the tab badge, Today and the diff screen say the same count", () => {
  // 되돌리면 깨진다: compare_workday 와 group_changes 가 서로 다른 목록을 쓰게 하기(README 함정 4).
  const fx: Fixtures = {
    nowIso: "2026-11-20T18:20:00+09:00",
    workdays: ["20261120"],
    journals: [
      {
        relative_path: "20261120/Features_to_add/1000_feature_demo.md",
        workday: "20261120",
        type: "feature",
        slug: "demo",
        status: "done",
        difficulty: null,
        title: "Demo title",
        checkbox: true,
        session_id: "20261120-001",
        agent_id: "claude-code",
        agent_version: null,
        agent_session: null,
        verified_by_user: false,
        verified_stale: false,
        evidence: 2,
        created_at: "2026-11-20T10:00:00+09:00",
        updated_at: null,
        tags: [],
        files: [{ path: "src/a.ts", op: "update" }],
        related: [],
        language: "ko",
        files_count: 1,
        body_markdown: "body",
        byte_size: 4,
      },
    ],
    plans: [],
    changes: [
      { path: "src/a.ts", op: "M" },
      { path: "src/b.ts", op: "M" },
    ],
    patches: {},
    unrecorded: ["src/b.ts"],
  };
  const w = window as unknown as { __ipcMissing: Record<string, number> };

  it("the no-journal group files equal compare_workday unrecorded", async () => {
    const handle = createHandle(fx, new URLSearchParams());
    const cmp = (await handle("oculpm_compare_workday", { projectId: 1, workday: "20261120" })) as { unrecorded_total: number; sessions: { unrecorded: string[] }[] };
    const groups = (await handle("oculpm_group_changes", { projectId: 1, paths: fx.changes.map((c) => c.path) })) as { entry_path: string | null; files: string[] }[];
    const none = groups.find((g) => g.entry_path === null);
    expect(none?.files).toEqual(cmp.sessions[0].unrecorded);
    expect(cmp.unrecorded_total).toBe(none?.files.length);
    expect(groups.find((g) => g.entry_path)?.files).toEqual(["src/a.ts"]);
  });

  it("empty=1 empties journals, changes and unrecorded alike", async () => {
    const handle = createHandle(fx, new URLSearchParams("empty=1"));
    expect(await handle("oculpm_list_journal_entries", { projectId: 1 })).toEqual([]);
    expect(await handle("git_uncommitted_changes", { projectId: 1 })).toEqual([]);
    const cmp = (await handle("oculpm_compare_workday", { projectId: 1, workday: "20261120" })) as { unrecorded_total: number };
    expect(cmp.unrecorded_total).toBe(0);
  });

  it("counts a command with no handler as missing instead of throwing", async () => {
    w.__ipcMissing = {};
    const handle = createHandle(fx, new URLSearchParams());
    expect(await handle("no_such_command", {})).toBeNull();
    expect(w.__ipcMissing.no_such_command).toBe(1);
  });
});

describe("never touches the app bundle or egress", () => {
  // 되돌리면 깨진다: 앱 소스가 하네스를 불러오기, vite 빌드 입력에 harness.html 넣기, 산출물 .gitignore 지우기.
  it("the vite build input is index.html alone — the dev server serves harness.html", () => {
    expect(read("vite.config.ts")).not.toMatch(/rollupOptions|rolldownOptions|\binput\b|harness/);
    expect(read("index.html")).not.toContain("harness");
    expect(read("scripts/harness/harness.html")).toContain("/scripts/harness/entry.ts");
  });

  it("typecheck covers the harness so a bindings drift turns it red", () => {
    expect(read("tsconfig.json")).toContain("scripts/harness");
    expect(read("scripts/harness/types.ts")).toContain("@/lib/bindings");
  });

  it("does not commit generated output (fixtures, PNGs)", () => {
    expect(read(".gitignore")).toMatch(/^scripts\/harness\/generated\/$/m);
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["harness"]).toContain("--port 1434");
    expect(pkg.scripts["harness:shots"]).toContain("scripts/harness/shots.mjs");
    expect(pkg.scripts["harness:fixtures"]).toContain("scripts/harness/fixtures.mjs");
  });

  it("app sources under src never import the harness", () => {
    // grep 은 일치가 없으면 끝 코드 1 — 그게 정상이라 `|| true` 대신 sh 로 감싼다.
    const out = execFileSync("sh", ["-c", "grep -rl scripts/harness src --include='*.ts' --include='*.tsx' --include='*.css' || true"], { cwd: ROOT, encoding: "utf8" });
    const hits = out.split("\n").filter(Boolean).filter((f) => !f.startsWith("src/__tests__/"));
    expect(hits).toEqual([]);
  });
});
