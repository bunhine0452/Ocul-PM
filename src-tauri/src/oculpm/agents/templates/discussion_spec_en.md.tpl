<!-- template_version: 6 -->
# Discussion-doc spec (ocul-pm)

> Managed by ocul-pm (do not edit — refreshed on app upgrades).
> This is the on-demand spec referenced by the master rules (`AGENTS.md` §5).

If the journal is *what happened* and the planner is *what/how far*, a **discussion doc** (`.oculpm/discussion/<slug>/discussion.md`) is the step *before* — meeting notes for "is this a problem? what are the options?" prior to a decision.

## When (request-driven — not per task)

- Only when the user **explicitly asks** to "think this through / draft a big plan / compare options".
- Or when an issue needs refining across multiple sessions before it can be decided.
- Never for routine work — once work is done, journal + planner are the record.

## Format (YAML frontmatter at the very top)

```markdown
---
oculpm_discussion: v1
id: onnx-cache-strategy        # English kebab-case, same as the folder name
title: "Deciding the onnx model cache strategy"
status: open                   # open | resolved | archived
created: 2026-06-29
updated: 2026-06-29
owner: claude-code             # your agent.id
---

## 문제 정의
One or two paragraphs on what must be decided. (required, first)

## 후보 해결 방안
### Option A — title {#opt-a}
- pros / cons / cost

## 토의 / 메모
<!-- oculpm:discussion-log begin v1 -->
| 시각 | 작성자 | 내용 |
|---|---|---|
| 2026-06-29T14:03:00+09:00 | claude-code | A is cheapest |
<!-- oculpm:discussion-log end -->

## 결론
Adopted option + rationale. (flip status to resolved)

## 다음 단계
- [ ] follow-up task {#next-1}
```

## Rules

1. Fill `## 문제 정의` **first** (required). No discussion without a problem statement.
2. Options are `### title {#opt-id}`, next steps are `- [ ] text {#next-id}` — stable ids at the end of a single line (same as planner items: never wrap).
3. Append discussion remarks as **one row** to the managed block table: `| <ISO time+offset> | <your agent.id> | <content> |`. Never edit existing rows.
4. When concluded, write `## 결론` and flip frontmatter `status` to `resolved` (the user promotes it to the planner).

## Never

- **Never track progress here** — that is the planner's job.
- Execution records go to the journal — don't accumulate run logs here.
- Never modify `resolved`/`archived` docs (the user closed them).
- Never include secrets / API keys.
