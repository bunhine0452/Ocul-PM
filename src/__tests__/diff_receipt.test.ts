// PR 영수증 (11-02) — 같은 기록이면 같은 마크다운. 리뷰어가 Ocul 없이 읽는다.
import { beforeEach, describe, expect, it } from "vitest";

import { setLangSetting, t } from "@/i18n";
import type { DigestPlan, Receipt, TodayDigest } from "@/lib/bindings";
import { receiptMarkdown } from "@/features/diff/receipt";

const receipt: Receipt = {
  branch: "feat/x",
  base_label: "main",
  commits: 2,
  files: 3,
  journals: [
    { path: "20261102/Bugs/1000_bug_a.md", title: "셸: 이름이 겹쳤다", kind: "bug", evidence: 2, proof: "pnpm test: 993 passed" },
    { path: "20261102/Chores/1100_chore_b.md", title: "잡일", kind: "chore", evidence: 0, proof: null },
  ],
  unrecorded: ["docs/new.md"],
};

const plan = (over: Partial<DigestPlan>): DigestPlan => ({
  plan_id: "p",
  title: "계획 P",
  progress: 1,
  done_count: 1,
  item_count: 1,
  closable: false,
  updated_at: "2026-11-02",
  done_when: null,
  check: "pnpm test",
  last_verdict: { passed: true, summary: "993 passed", ts: new Date().toISOString(), agent_id: "claude-code", item_id: "x" },
  stale_files: ["src/a.ts"],
  next: null,
  ...over,
});

const digest = (plans: DigestPlan[]): TodayDigest => ({
  plans,
  needs_user: [],
  blocked: [],
  journal_plan: [{ journal_ref: ".oculpm/journal/20261102/Bugs/1000_bug_a.md", plan_id: "p", plan_title: "계획 P", item_id: "x" }],
});

beforeEach(() => setLangSetting("ko"));

describe("PR 영수증", () => {
  it("가지 · 계획의 확인 명령 결과 · 일지마다 끝 줄 · 기록 없는 변경을 싣는다", () => {
    const md = receiptMarkdown(receipt, digest([plan({}), plan({ plan_id: "other", title: "남의 계획" })]), t);
    expect(md).toContain("### Ocul 영수증 · `feat/x` ← `main`");
    expect(md).toContain(t("diff.receipt.meta", { commits: 2, files: 3 }));
    expect(md).toMatch(/- ✓ 「계획 P」 — `pnpm test` → 993 passed → .* · ⚠ 통과 뒤 바뀐 파일 1개/);
    expect(md).not.toContain("남의 계획");
    expect(md).toContain(t("diff.receipt.journals", { n: 2, m: 1 }));
    expect(md).toContain("- ✓ 셸: 이름이 겹쳤다 — pnpm test: 993 passed");
    expect(md).toContain(`- · 잡일 — ${t("diff.receipt.noProof")}`);
    expect(md).toContain("- `docs/new.md`");
  });

  it("계획 집계를 못 읽어도 영수증은 선다 — 계획 칸만 빠진다", () => {
    const md = receiptMarkdown({ ...receipt, unrecorded: [], journals: [] }, null, t);
    expect(md).not.toContain(t("diff.receipt.plans"));
    expect(md).toContain(t("diff.receipt.noJournals"));
    expect(md).not.toContain(t("diff.receipt.unrecorded", { n: 0 }));
  });
});
