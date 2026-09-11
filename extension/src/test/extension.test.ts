import * as assert from "assert";
import * as vscode from "vscode";
import type { ExtensionState } from "../extension";
import { listJournalFiles, listPlans, localWorkday } from "../oculpm/store";
import { applyToggle } from "../tree/toggle";

suite("Ocul-PM 확장", () => {
  test("활성화가 throw 없이 끝나고 상태를 내보낸다", async () => {
    const ext = vscode.extensions.getExtension<ExtensionState>("oculpm.ocul-pm");
    assert.ok(ext, "oculpm.ocul-pm 확장을 찾지 못함");
    const state = await ext.activate();
    assert.strictEqual(ext.isActive, true);
    // 읽기 전용 여부는 바이너리 유무의 파생값 — 둘이 어긋나면 안 된다.
    assert.strictEqual(state.readOnly, state.binary.path === null);
    // 찾는 즉시 멈추므로 최소 1곳, 못 찾으면 기본 후보 2곳.
    assert.ok(state.binary.tried.length >= (state.readOnly ? 2 : 1));
  });

  test("설정 경로가 비어 있으면 후보에 끼지 않고, 지정하면 첫 후보다", async () => {
    const cfg = vscode.workspace.getConfiguration("oculpm");
    await cfg.update("mcpBinaryPath", "/nowhere/oculpm-mcp", vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand("ocul-pm.rescanBinary");
      const state = vscode.extensions.getExtension<ExtensionState>("oculpm.ocul-pm")!.exports;
      assert.strictEqual(state.binary.tried[0], "/nowhere/oculpm-mcp");
      assert.notStrictEqual(state.binary.source, "setting");
    } finally {
      await cfg.update("mcpBinaryPath", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("커맨드 2개가 등록된다", async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes("ocul-pm.openWebsite"));
    assert.ok(all.includes("ocul-pm.rescanBinary"));
  });
});

suite("사이드바 트리 (이 저장소 워크스페이스)", () => {
  test("오늘 일지·활성 플랜 개수가 읽기 계층과 같다", async () => {
    const ext = vscode.extensions.getExtension<ExtensionState>("oculpm.ocul-pm")!;
    const { trees } = await ext.activate();
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;

    const days = await trees.journal.getChildren();
    assert.ok(days.length > 0 && days.length <= 7, `날짜 노드 ${days.length}`);
    const today = days.find((d) => d.kind === "day" && d.day === localWorkday());
    assert.ok(today && today.kind === "day", "오늘 노드");
    const expected = (await listJournalFiles(root, { workday: localWorkday() })).length;
    assert.strictEqual(today.count, expected);
    let entries = 0;
    for (const t of await trees.journal.getChildren(today)) {
      entries += (await trees.journal.getChildren(t)).length;
    }
    assert.strictEqual(entries, expected);

    const plans = await trees.plans.getChildren();
    const active = (await listPlans(root)).filter((p) => p.plan.status === "active");
    assert.strictEqual(plans.length, active.length);
    assert.ok(plans.some((p) => p.kind === "plan" && p.file.plan.id === "vscode-extension-round"));
    const first = plans[0];
    assert.ok(first.kind === "plan");
    let items = 0;
    for (const ph of await trees.plans.getChildren(first)) {
      for (const it of await trees.plans.getChildren(ph)) {
        items += 1 + (await trees.plans.getChildren(it)).length;
      }
    }
    assert.strictEqual(items, first.file.plan.items.length);
  });
});

suite("워처 · 멀티루트", () => {
  test("임시 폴더를 워크스페이스에 더하면 추적 여부를 다시 보고, 일지가 생기면 1초 안에 트리가 갱신된다", async function () {
    this.timeout(15000);
    const os = await import("node:os");
    const fsp = (await import("node:fs")).promises;
    const path = await import("node:path");
    const ext = vscode.extensions.getExtension<ExtensionState>("oculpm.ocul-pm")!;
    const { trees } = await ext.activate();

    // macOS 의 tmpdir 은 `/var` → `/private/var` 심링크 — 워처는 실경로로 보고하므로 실경로로 연다.
    const tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "oculpm-ext-")));
    const before = (await trees.journal.getChildren()).length; // 저장소 하나 → 날짜 노드들
    try {
      // 1) 미추적 폴더 추가 — 루트 노드에 끼지 않는다 (폴더 층이 생기지 않는다).
      const added = vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders!.length, 0, { uri: vscode.Uri.file(tmp) });
      assert.ok(added);
      await waitFor(() => vscode.workspace.workspaceFolders!.length === 2);
      // 새 폴더의 재귀 워처(parcel)가 준비되는 데 시간이 걸린다 — 실사용에선 폴더가
      // 열려 있은 지 오래라 무관. 1초 예산은 그 뒤부터 잰다.
      await new Promise((r) => setTimeout(r, 1500));
      const roots = await trees.journal.getChildren();
      assert.strictEqual(roots.length, before, "미추적 폴더는 트리에 안 낀다");

      // 2) 첫 일지 파일이 생기면 그 이벤트가 곧 추적 시작 — 1초 안에 갱신되고 폴더 층이 생긴다.
      const day = "20260911";
      await fsp.mkdir(path.join(tmp, ".oculpm", "journal", day, "Chores"), { recursive: true });
      const fired = waitForEvent(trees.journal.onDidChangeTreeData, 1000);
      await fsp.writeFile(
        path.join(tmp, ".oculpm", "journal", day, "Chores", "1200_chore_watch-probe.md"),
        "---\nschema_version: 1\ntype: chore\nslug: watch-probe\nstatus: done\ncreated_at: \"2026-09-11T12:00:00+09:00\"\nsession_id: manual-x\nagent:\n  id: test\nlanguage: ko\n---\n[x] 워처 프로브\n",
      );
      await fired;
      const folderNode = (await trees.journal.getChildren()).find((n) => n.kind === "folder" && n.root === tmp);
      assert.ok(folderNode, "임시 폴더 노드");
      const days = await trees.journal.getChildren(folderNode);
      assert.strictEqual(days.length, 1);
      assert.ok(days[0].kind === "day" && days[0].count === 1);
    } finally {
      const idx = vscode.workspace.workspaceFolders!.findIndex((f) => f.uri.fsPath === tmp);
      if (idx >= 0) {
        vscode.workspace.updateWorkspaceFolders(idx, 1);
        await waitFor(() => vscode.workspace.workspaceFolders!.length === 1);
      }
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

async function waitFor(pred: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await pred()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor 시간 초과");
}

function waitForEvent<T>(ev: vscode.Event<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { d.dispose(); reject(new Error(`${ms}ms 안에 이벤트 없음`)); }, ms);
    const d = ev((v) => { clearTimeout(t); d.dispose(); resolve(v); });
  });
}

suite("체크박스 토글 → oculpm-mcp plan_update", () => {
  test("[ ]→[x] 가 디스크에 반영되고 plan-log 에 vscode-ext 행이 붙는다 · 잠긴 플랜은 거부", async function () {
    this.timeout(20000);
    const os = await import("node:os");
    const fsp = (await import("node:fs")).promises;
    const path = await import("node:path");
    const ext = vscode.extensions.getExtension<ExtensionState>("oculpm.ocul-pm")!;
    const state = await ext.activate();
    if (state.readOnly) {
      this.skip(); // 앱이 없는 머신 — 쓰기 경로는 실기기(EVALS 2번)에서
    }
    const tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "oculpm-toggle-")));
    const planDir = path.join(tmp, ".oculpm", "planner");
    await fsp.mkdir(path.join(tmp, ".oculpm", "journal"), { recursive: true });
    await fsp.mkdir(planDir, { recursive: true });
    const plan = (id: string, status: string) =>
      `---\noculpm_plan: v1\nid: ${id}\ntitle: "${id}"\nstatus: ${status}\ncreated: 2026-09-11\nupdated: 2026-09-11\nowner: test\n---\n\n## P {#p}\n- [ ] 리프 {#leaf}\n- [ ] 부모 {#parent}\n  - [ ] 자식 {#child}\n\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n|---|---|---|---|---|---|\n<!-- oculpm:plan-log end -->\n`;
    await fsp.writeFile(path.join(planDir, "live.md"), plan("live", "active"));
    await fsp.writeFile(path.join(planDir, "shut.md"), plan("shut", "done"));
    try {
      const client = state.clientFor(tmp)!;
      const r = await applyToggle(client, "live", "leaf", true);
      assert.strictEqual(r.to, "done");
      const md = await fsp.readFile(path.join(planDir, "live.md"), "utf8");
      assert.ok(/^- \[x\] 리프 \{#leaf\}$/m.test(md), "글리프가 [x] 로");
      assert.ok(/\| #leaf \| vscode-ext \| /.test(md), "plan-log 에 vscode-ext 행");
      // 되돌리기 — 직전 응답 hash 가 아니라 다시 읽은 hash 로도 된다.
      const back = await applyToggle(client, "live", "leaf", false);
      assert.strictEqual(back.to, "todo");

      // 잠긴 플랜: 서버가 거부하고 파일은 그대로.
      await assert.rejects(applyToggle(client, "shut", "leaf", true));
      assert.strictEqual(await fsp.readFile(path.join(planDir, "shut.md"), "utf8"), plan("shut", "done"));
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

suite("MCP 공급자 · 규칙 주입", () => {
  test("추적 폴더마다 oculpm (<폴더>) 정의 하나, --root 와 cwd 가 그 폴더", async () => {
    const ext = vscode.extensions.getExtension<ExtensionState>("oculpm.ocul-pm")!;
    const state = await ext.activate();
    const handle = state.mcp();
    assert.ok(handle, "VS Code ≥1.101 이면 공급자가 등록된다");
    const defs = await handle.provide();
    if (state.readOnly) {
      assert.strictEqual(defs.length, 0, "바이너리 없으면 0개 — 오류 아님");
      return;
    }
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const mine = defs.find((d) => d.args[1] === root);
    assert.ok(mine, "이 저장소 정의");
    assert.strictEqual(mine.label, "oculpm (ai-pm)");
    assert.strictEqual(mine.command, state.binary.path);
    assert.deepStrictEqual(mine.args, ["--root", root]);
    assert.strictEqual(mine.cwd?.fsPath, root);
    assert.strictEqual(mine.env.OCULPM_AGENT_ID, "copilot");
  });

  test("project_init 은 추적 프로젝트에서 규칙 파일을 보완하고 두 번째 호출은 무변경", async function () {
    this.timeout(20000);
    const os = await import("node:os");
    const fsp = (await import("node:fs")).promises;
    const path = await import("node:path");
    const ext = vscode.extensions.getExtension<ExtensionState>("oculpm.ocul-pm")!;
    const state = await ext.activate();
    if (state.readOnly) {
      this.skip();
    }
    const tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "oculpm-rules-")));
    await fsp.mkdir(path.join(tmp, ".oculpm", "journal"), { recursive: true });
    try {
      const client = state.clientFor(tmp)!;
      const r1 = await client.callTool<{ initialized: boolean; adapters_synced: number }>("project_init", { confirm: true });
      assert.strictEqual(r1.initialized, false, "이미 추적 중 → 보완만");
      assert.ok(r1.adapters_synced > 0);
      const agents = await fsp.readFile(path.join(tmp, "AGENTS.md"), "utf8");
      assert.ok(agents.includes("<!-- oculpm:begin"), "관리 블록");
      const master = await fsp.readFile(path.join(tmp, ".oculpm", "agents", "_template.md"), "utf8");
      assert.ok(master.length > 0, "마스터 템플릿 시드 — 확장은 복사본을 갖지 않는다");
      await client.callTool("project_init", { confirm: true });
      assert.strictEqual(await fsp.readFile(path.join(tmp, "AGENTS.md"), "utf8"), agents, "멱등");
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

suite("URI 핸들러 — 앱에서 'VS Code 로 열기'", () => {
  test("절대경로 일지를 열면 트리에서 그 일지가 선택된다 · 폴더 밖은 false", async function () {
    this.timeout(15000);
    const ext = vscode.extensions.getExtension<ExtensionState>("oculpm.ocul-pm")!;
    const state = await ext.activate();
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const files = await listJournalFiles(root, { workday: localWorkday() });
    const target = files[files.length - 1];
    assert.ok(target, "오늘 일지가 있어야 한다");
    assert.strictEqual(await state.openEntry(target.absPath), true);
    // reveal 은 비동기 — 선택이 잡힐 때까지 잠시.
    await waitFor(() => {
      const sel = state.views.journal.selection[0];
      return sel?.kind === "entry" && sel.file.absPath === target.absPath;
    }, 5000);
    assert.strictEqual(await state.openEntry("/nowhere/.oculpm/journal/20260911/Chores/1_chore_x.md"), false);
  });
});
