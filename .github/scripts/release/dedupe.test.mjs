// 같은 태그의 릴리스 run 중복 판정 (dedupe.mjs) — node --test .github/scripts/release/
//
// 출발점은 실제 사고다: v3.9.0 태그 push 하나에 Release run 이 같은 초에 둘 떴다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { blockingRun } from "./dedupe.mjs";

const TAG = "v3.9.0";
const run = (id, status, conclusion = null, over = {}) => ({
  id,
  event: "push",
  head_branch: TAG,
  status,
  conclusion,
  html_url: `https://github.com/bunhine0452/Ocul-PM/actions/runs/${id}`,
  ...over,
});
// 2026-10-07 13:13:53Z — 같은 초에 뜬 둘.
const A = 37626868742;
const B = 37626870355;

describe("중복 판정 — 실제 v3.9.0 사고", () => {
  const both = [run(B, "in_progress"), run(A, "in_progress")];

  test("뒤에 뜬 run 은 앞선 run 에 막힌다", () => {
    assert.equal(blockingRun(both, { id: B, tag: TAG })?.id, A);
  });

  test("앞선 run 은 뒤의 run 을 보고도 막히지 않는다 — 둘 중 정확히 하나만 남는다", () => {
    assert.equal(blockingRun(both, { id: A, tag: TAG }), null);
  });

  test("셋이 떠도 가장 앞선 run 을 가리킨다", () => {
    const three = [...both, run(B + 1, "queued")];
    assert.equal(blockingRun(three, { id: B + 1, tag: TAG })?.id, A);
  });
});

describe("막지 않는 경우 — 복구 경로가 살아 있어야 한다", () => {
  test("앞선 run 이 실패했으면 태그를 다시 민 새 run 은 돈다", () => {
    assert.equal(blockingRun([run(A, "completed", "failure")], { id: B, tag: TAG }), null);
  });

  test("앞선 run 이 취소됐으면(스스로 물러난 중복 포함) 막지 않는다", () => {
    assert.equal(blockingRun([run(A, "completed", "cancelled")], { id: B, tag: TAG }), null);
  });

  test("같은 run 의 re-run 은 id 가 같아 중복이 아니다", () => {
    assert.equal(blockingRun([run(A, "in_progress")], { id: A, tag: TAG }), null);
  });

  test("드라이런(workflow_dispatch)은 세지 않는다", () => {
    const dispatch = run(A, "in_progress", null, { event: "workflow_dispatch", head_branch: "main" });
    assert.equal(blockingRun([dispatch], { id: B, tag: TAG }), null);
  });

  test("같은 커밋의 다른 태그는 다른 릴리스다", () => {
    const other = run(A, "in_progress", null, { head_branch: "v3.9.1" });
    assert.equal(blockingRun([other], { id: B, tag: TAG }), null);
  });
});

describe("막는 경우", () => {
  test("앞선 run 이 이미 공개까지 성공했으면 다시 민 태그의 run 은 물러난다", () => {
    assert.equal(blockingRun([run(A, "completed", "success")], { id: B, tag: TAG })?.id, A);
  });

  test("대기 중(queued·waiting)인 앞선 run 도 막는다", () => {
    for (const status of ["queued", "waiting", "requested", "pending"]) {
      assert.equal(blockingRun([run(A, status)], { id: B, tag: TAG })?.id, A, status);
    }
  });
});

describe("CLI", () => {
  const SCRIPT = fileURLToPath(new URL("./dedupe.mjs", import.meta.url));
  const cli = (runs, self) =>
    execFileSync("node", [SCRIPT, "--self", String(self), "--tag", TAG], {
      input: JSON.stringify(runs),
      encoding: "utf8",
    }).trim();

  test("막히면 앞선 run 한 줄, 아니면 빈 출력", () => {
    const both = [run(A, "in_progress"), run(B, "in_progress")];
    assert.equal(cli(both, B), `${A} in_progress/- https://github.com/bunhine0452/Ocul-PM/actions/runs/${A}`);
    assert.equal(cli(both, A), "");
  });

  test("인자가 모자라면 실패한다 — 조용히 통과시키지 않는다", () => {
    assert.throws(() =>
      execFileSync("node", [SCRIPT, "--tag", TAG], { input: "[]", encoding: "utf8", stdio: "pipe" }),
    );
  });
});
