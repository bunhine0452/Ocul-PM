// 읽기 계층 판정 — 픽스처는 Rust 파서 테스트와 **같은 파일**
// (`src-tauri/tests/fixtures/*.md`, include_str! 로 그쪽도 읽는다). 규격이
// 바뀌면 양쪽 테스트가 같이 붉어진다. 두 번째 묶음은 이 저장소의 실제
// `.oculpm/` 을 그대로 읽어 파서 집계를 순진한 파일 집계와 맞춘다.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter";
import { parseJournalEntry, parseJournalPath } from "./journal";
import { foldWrappedItems, parsePlan, rollupStatus } from "./planner";
import { isTracked, listJournalFiles, listPlans, localWorkday } from "./store";

const REPO = path.resolve(__dirname, "../../..");
const FIXTURES = path.join(REPO, "src-tauri/tests/fixtures");
const read = (f: string) => fs.readFile(path.join(FIXTURES, f), "utf8");

describe("journal_sample.md (Rust frontmatter 테스트와 공유)", () => {
  it("parses_well_formed_frontmatter_with_no_warnings 와 같은 값을 읽는다", async () => {
    const e = parseJournalEntry(await read("journal_sample.md"));
    expect(e.warnings).toEqual([]);
    expect(e.parsed).toBe(true);
    expect(e.type).toBe("bug");
    expect(e.slug).toBe("changelog-export-param-mismatch");
    expect(e.status).toBe("done");
    expect(e.createdAt).toBe("2026-05-22T20:55:00+09:00");
    expect(e.sessionId).toBe("20260522-001");
    expect(e.agentId).toBe("claude-code");
    expect(e.agentVersion).toBe("opus-4.7");
    expect(e.language).toBe("ko");
    expect(e.filesTouched).toEqual([{ path: "src-tauri/src/db.rs", op: "update" }]);
    expect(e.tags).toEqual(["changelog", "sqlite"]);
    expect(e.title).toBe("Changelog Export 파라미터 불일치");
    expect(e.body.startsWith("[x] Changelog Export")).toBe(true);
  });

  it("울타리 규칙 — 없으면 전부 본문, 안 닫히면 원문 보존+경고, 깨진 YAML 은 raw 만", () => {
    expect(splitFrontmatter("no fence\n")).toMatchObject({ parsed: null, body: "no fence\n", warnings: [] });
    const open = splitFrontmatter("---\nfoo: 1\nbody");
    expect(open.body).toBe("---\nfoo: 1\nbody");
    expect(open.warnings).toHaveLength(1);
    const broken = splitFrontmatter("---\nfoo: [unclosed\n---\nbody\n");
    expect(broken.parsed).toBeNull();
    expect(broken.rawYaml).toBe("foo: [unclosed");
    expect(broken.body).toBe("body\n");
  });

  it("경로 규약 — TypeFolder·type·slug 를 해석하고 규격 밖은 null", () => {
    expect(parseJournalPath("20260911/Chores/1403_chore_vscode-extension-inception.md")).toMatchObject({
      workday: "20260911", typeFolder: "Chores", hhmm: "1403", type: "chore", slug: "vscode-extension-inception",
    });
    expect(parseJournalPath("20260911/Chores/README.md")).toBeNull();
    expect(parseJournalPath("20260911/Unknown/1403_chore_x.md")).toBeNull();
    expect(parseJournalPath("2026/Chores/1403_chore_x.md")).toBeNull();
  });
});

describe("plan_sample.md (Rust parse.rs 테스트와 공유)", () => {
  it("parses_full_plan 과 같은 값을 읽는다", async () => {
    const p = parsePlan(await read("plan_sample.md"), "from-filename");
    expect(p.warnings).toEqual([]);
    expect(p.id).toBe("fastembed-stabilize");
    expect(p.title).toBe("fastembed 안정화");
    expect(p.status).toBe("active");
    expect(p.owner).toBe("claude-code");
    expect(p.created).toBe("2026-06-07");
    expect(p.items).toHaveLength(6);
    expect(p.items[0]).toMatchObject({
      itemId: "abs-cache", status: "done", title: "fastembed 캐시 절대경로 고정",
      phase: "Phase A — 캐시 경로 안정화", parentItem: undefined,
    });
    // 부모 [~] 는 하위 [ ] 롤업 → todo (파일 글리프가 아니라 파생값)
    expect(p.items[1]).toMatchObject({ itemId: "seed-verify", status: "todo" });
    expect(p.items[2]).toMatchObject({ itemId: "fresh-machine", parentItem: "seed-verify", status: "todo" });
    expect(p.items[3]).toMatchObject({ itemId: "dl-ux", status: "blocked", note: "진행 UI 부재" });
    expect(p.items[4]).toMatchObject({ itemId: "bundle", status: "deferred", note: "이월: 배포 라운드" });
    expect(p.items[5]).toMatchObject({ itemId: "search-scopes", phase: "Phase B — 검색 품질" });
    expect(p.phases.map((x) => x.name)).toEqual(["Phase A — 캐시 경로 안정화", "Phase B — 검색 품질"]);
    expect(p.log).toHaveLength(2);
    expect(p.log[0]).toMatchObject({ itemId: "abs-cache", agentId: "claude-code", change: "~→x" });
    expect(p.log[1]).toMatchObject({ itemId: "seed-verify", agentId: "user", journal: "" });
  });

  it("글리프 6종·첫 {#id} 우선·줄바꿈 접기·롤업", () => {
    const md = [
      "---", "oculpm_plan: v1", "id: g", "title: \"g\"", "status: active", "---",
      "## P", "- [ ] a {#a}", "- [~] b {#b}", "- [x] c {#c}", "- [!] d {#d}", "- [>] e {#e}", "- [-] f {#f}",
      "- [ ] 본문에 `{#inner}` 가 먼저 오면 그게 id 다 {#outer}",
      "- [ ] 긴 항목이", "  둘째 줄로 넘어가면 {#wrapped}",
      "- [?] 모르는 글리프 {#unk}",
    ].join("\n");
    const p = parsePlan(md, "g");
    expect(p.items.map((i) => i.status).slice(0, 6)).toEqual(["todo", "in_progress", "done", "blocked", "deferred", "dropped"]);
    expect(p.items[6].itemId).toBe("inner");
    expect(p.items[7]).toMatchObject({ itemId: "wrapped", title: "긴 항목이 둘째 줄로 넘어가면" });
    expect(p.items[8].status).toBe("todo");
    expect(p.warnings).toEqual(["unknown item glyph '[?]'; defaulting to todo"]);
    expect(foldWrappedItems("- [ ] a\n  b\n  - [ ] c")).toBe("- [ ] a b\n  - [ ] c");
    expect(rollupStatus(["dropped"])).toBe("dropped");
    expect(rollupStatus(["done", "blocked"])).toBe("blocked");
    expect(rollupStatus(["done", "done"])).toBe("done");
    expect(rollupStatus(["done", "todo"])).toBe("in_progress");
  });

  it("frontmatter 없는 플랜은 # H1 을 제목으로, done/archived 는 그대로", () => {
    expect(parsePlan("# Plan — 제목\n- [ ] x {#x}", "fid")).toMatchObject({ id: "fid", title: "제목", status: "active" });
    expect(parsePlan("---\nid: z\nstatus: done\n---\n", "z").status).toBe("done");
  });
});

describe("이 저장소의 실제 .oculpm/", () => {
  it("추적 대상이고 파서 집계가 순진한 파일 집계와 같다", async () => {
    if (!(await isTracked(REPO))) {
      return; // 얕은 체크아웃 등 — 픽스처 묶음이 규격을 판정하므로 여기선 건너뛴다
    }
    const today = localWorkday();
    const files = await listJournalFiles(REPO, { workday: today });
    const naive = await naiveJournalCount(path.join(REPO, ".oculpm/journal", today));
    expect(files.length).toBe(naive);
    for (const f of files.slice(-3)) {
      const md = await fs.readFile(f.absPath, "utf8");
      const e = parseJournalEntry(md, f);
      expect(e.parsed).toBe(true);
      expect(e.type).toBe(f.type);
      expect(e.slug).toBe(f.slug);
    }

    const plans = await listPlans(REPO);
    const active = plans.filter((p) => p.plan.status === "active");
    expect(active.length).toBeGreaterThan(0);
    for (const { absPath, plan } of active) {
      const md = await fs.readFile(absPath, "utf8");
      const naiveItems = (foldWrappedItems(splitFrontmatter(md).body).match(/^\s*[-*] \[[^\]]*\]/gm) ?? []).length;
      expect(plan.items.length, plan.id).toBe(naiveItems);
    }
  });
});

async function naiveJournalCount(dayDir: string): Promise<number> {
  let n = 0;
  let folders: string[] = [];
  try {
    folders = await fs.readdir(dayDir);
  } catch {
    return 0;
  }
  for (const f of folders) {
    const files = await fs.readdir(path.join(dayDir, f));
    n += files.filter((x) => /^\d{4}_(bug|feature|error|refactor|chore)_[A-Za-z0-9-]+\.md$/.test(x)).length;
  }
  return n;
}
