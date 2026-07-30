// Shared AI context builders (Group B Stage 1 — 컨텍스트 통합).
//
// Extracted from ChatPanel so both the code-view ChatPanel and the main
// fullscreen AiPanelScreenV2 ground the model on the same project context:
// RAG code snippets, ocul-pm journal + AGENTS rules, planner goals, and git.
// ChatPanel keeps its own inline assembly (it also injects the open file +
// the interactive planner-action protocol); `assembleAiContext` is the
// one-call helper the simpler panels use.

import { commands, type ChunkSearchResult } from "@/lib/bindings";
import type { Settings } from "@/lib/settings";
import { buildActionInstruction } from "./aiActions";

export function buildContextSystem(chunks: ChunkSearchResult[]): string {
  const blocks = chunks
    .map(
      (c) =>
        `### \`${c.file_path}\` (lines ${c.start_line}–${c.end_line})\n\`\`\`\n${c.content}\n\`\`\``,
    )
    .join("\n\n");
  return [
    "You have access to the user's codebase. The most relevant snippets for the current question are below.",
    "When you reference code, cite the file path and line range.",
    "",
    blocks,
  ].join("\n");
}

export async function buildGitSystemContext(
  projectId: number | null,
  limit = 15,
): Promise<string> {
  if (projectId == null) return "";
  const statusRes = await commands.gitStatus(projectId);
  if (statusRes.status !== "ok" || !statusRes.data.is_git_repo) return "";

  const status = statusRes.data;
  let markdown = "### Project git context\n";
  if (status.head_branch) {
    markdown += `- Current branch: \`${status.head_branch}\`\n`;
  }
  const gh = status.remotes.find((r) => r.host === "github.com" && r.owner && r.repo);
  if (gh) {
    markdown += `- GitHub: \`${gh.owner}/${gh.repo}\`\n`;
  } else if (status.remotes.length > 0) {
    markdown += `- Remote: \`${status.remotes[0].url}\`\n`;
  }

  const logRes = await commands.gitLog(projectId, limit);
  if (logRes.status === "ok" && logRes.data.length > 0) {
    markdown += `\nRecent commits (newest first):\n`;
    for (const c of logRes.data) {
      const when = new Date(c.timestamp * 1000).toISOString().slice(0, 10);
      markdown += `- \`${c.short_sha}\` ${when} (${c.author_name}) — ${c.subject}\n`;
    }
  }
  return markdown;
}

/**
 * 이 블록에 실을 계획 수 상한. `planList` 에는 상태 필터가 없어 전량을 주므로
 * 활성만 걸러도 큰 프로젝트에서는 여전히 많다.
 */
const MAX_CTX_PLANS = 4;

/** 종료 상태 — 더 이상 행동 대상이 아닌 항목. */
const TERMINAL_ITEM_STATUS = new Set(["done", "dropped"]);

export async function buildPlannerSystemContext(projectId: number | null): Promise<string> {
  // S1 / planner-unify (2026-06-22): the file-based Plan (`.oculpm/planner/*.md`)
  // is the single SSOT — inject plans + items (with their `plan_id`/`item_id`)
  // so the assistant can reference them in json:action proposals.
  //
  // 토큰 라운드 (2026-07-30): 이 블록은 **매 메시지마다** 재조립돼 system 으로
  // 다시 올라간다(AiPanelScreenV2). 그런데 `planList` 에는 상태 필터가 없어서
  // 사용자가 명시적으로 잠근 done/archived 계획까지 매번 실려 갔다 — MCP
  // `plan_status` 는 active 만 주므로 같은 개념이 두 답을 내던 셈이다. 잠긴
  // 계획은 `plan_apply_edit` 가 쓰기를 거부하니 애초에 제안 대상이 될 수 없었다.
  // 실측: 이 저장소 13,670 B → 2,483 B (−82%).
  //
  // 종료된 항목(done/dropped)은 개수만 남긴다 — 완료 사실은 다음 할 일 판단에
  // 쓰이지만 phase·item_id 까지 실을 이유가 없다.
  if (projectId == null) return "";
  const pl = await commands.planList(projectId);
  if (pl.status === "error" || !pl.data.length) {
    return "";
  }
  const active = pl.data.filter((p) => p.status === "active");
  const shown = active.slice(0, MAX_CTX_PLANS);
  if (!shown.length) return "";

  let markdown = "### Current Workspace Plans (file-based SSOT, active only):\n";
  for (const p of shown) {
    markdown += `- **Plan (plan_id: ${p.plan_id})**: ${p.title} | Status: ${p.status} | ${p.done_count}/${p.item_count} done\n`;
    const dr = await commands.planGet(projectId, p.plan_id);
    if (dr.status !== "ok" || !dr.data) continue;

    const items = dr.data.items ?? [];
    const open = items.filter((it) => !TERMINAL_ITEM_STATUS.has(it.status));
    const closed = items.length - open.length;
    for (const it of open) {
      const mark = it.status === "in_progress" ? "~" : " ";
      const phase = it.phase ? `[${it.phase}] ` : "";
      markdown += `    - [${mark}] (item_id: ${it.item_id}) ${phase}${it.title}\n`;
    }
    if (closed > 0) markdown += `    - … 종료된 항목 ${closed}건 생략\n`;
  }
  if (active.length > shown.length) {
    markdown += `- … 활성 계획 ${active.length - shown.length}개 생략 (앞 ${MAX_CTX_PLANS}개만 표시)\n`;
  }
  return markdown;
}

/** Clamp long text so a single journal body / ruleset can't blow the token
 *  budget. Adds a visible elision marker. */
function clampText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() + "\n… (생략됨)" : s;
}

/** 규칙 다이제스트 예산 (문자 수). 한글은 1자 ≈ 3바이트라 실제로는 넉넉하다. */
const RULES_DIGEST_CHARS = 2500;

/**
 * 규칙 섹션 우선순위 — 예산이 허락하는 만큼 이 순서로 담는다.
 *
 * `## N.` 의 숫자로 지목한다: §5 금지 사항(시크릿·index 쓰기 금지)이 가장
 * 중요하고, §1 트리거와 §4 본문 헤더가 그 다음이다. §3 frontmatter 와 §7/§8 의
 * 파일 포맷 기계는 앱이 직접 쓰므로(어시스턴트는 json:action 을 제안할 뿐)
 * 뒤로 밀린다.
 */
const RULES_SECTION_PRIORITY = [5, 1, 4, 2, 6, 3, 7, 8];

/**
 * AGENTS 마스터를 `## ` 섹션 경계로 잘라 예산 안에 담는다.
 *
 * 이전에는 `clampText(master, 2500)` 이었는데, 그 위치가 §3 frontmatter 의 YAML
 * 블록 **중간** 이라 어시스턴트가 §4 본문 규칙부터 §8 까지를 한 번도 못 봤다 —
 * §5 의 **시크릿 금지** 를 포함해서다. 예산을 절약하려던 코드가 규칙 전달을
 * 조용히 깨뜨리고 있었던 셈이라, 이 함수는 토큰 최적화이기 전에 정합성 수정이다.
 *
 * 마스터(`.oculpm/agents/_template.md`)는 사용자가 편집할 수 있으므로 `## `
 * 헤딩이 없으면 예전 동작(단순 절단)으로 조용히 되돌아간다.
 */
export function digestRules(master: string, budget = RULES_DIGEST_CHARS): string {
  const text = master.trim();
  if (text.length <= budget) return text;

  // 관리 블록 주석은 규칙이 아니다.
  const body = text.replace(/<!--[\s\S]*?-->\n?/g, "");
  const marks: { index: number; num: number | null }[] = [];
  const re = /^## +(\d+)?/gm;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    marks.push({ index: m.index, num: m[1] ? Number(m[1]) : null });
  }
  if (marks.length === 0) return clampText(body.trim(), budget);

  const preamble = body.slice(0, marks[0].index).trim();
  const sections = marks.map((mk, i) => ({
    num: mk.num,
    text: body.slice(mk.index, marks[i + 1]?.index ?? body.length).trim(),
    order: i,
  }));

  const chosen: typeof sections = [];
  let used = preamble.length;
  const take = (s: (typeof sections)[number]) => {
    if (used + s.text.length + 2 > budget) return;
    chosen.push(s);
    used += s.text.length + 2;
  };
  // 우선순위로 고르고, 지목되지 않은 섹션은 문서 순서로 남은 예산에 담는다.
  for (const num of RULES_SECTION_PRIORITY) {
    const s = sections.find((x) => x.num === num);
    if (s) take(s);
  }
  for (const s of sections) {
    if (!chosen.includes(s)) take(s);
  }

  const omitted = sections.length - chosen.length;
  const out = [preamble, ...chosen.sort((a, b) => a.order - b.order).map((s) => s.text)]
    .filter(Boolean)
    .join("\n\n");
  return omitted > 0 ? `${out}\n\n… 규칙 ${omitted}개 절 생략 (전문은 AGENTS.md)` : out;
}

/**
 * Build a "프로젝트 작업 맥락" block from the most recent ocul-pm journal
 * entries + the project's AGENTS rules, so the assistant keeps the same
 * direction even when the session or model changes. Every call is best-effort:
 * any failure simply omits that part. `maxEntries` of 0 injects rules only.
 */
export async function buildOculpmSystemContext(
  projectId: number | null,
  maxEntries: number,
): Promise<string> {
  if (projectId == null) return "";
  const sections: string[] = [];

  if (maxEntries > 0) {
    const listRes = await commands.oculpmListJournalEntries(projectId, null, null);
    if (listRes.status === "ok" && listRes.data.length > 0) {
      const recent = listRes.data.slice(0, maxEntries);
      let md =
        "### 프로젝트 작업 맥락 (ocul-pm 작업일지, 최신순)\n" +
        "이 프로젝트에서 최근 진행한 작업 기록입니다. 작업 방향과 결정을 이어가세요.\n\n";
      for (const e of recent) {
        const date = e.created_at ? e.created_at.slice(0, 10) : e.workday;
        md += `- [${e.status}] ${e.title} _(${e.type}, ${e.agent_id}, ${e.files_count} 파일, ${date})_\n`;
      }

      // Hydrate the few most-recent entries with their body for real continuity.
      const bodies: string[] = [];
      for (const e of recent.slice(0, Math.min(3, recent.length))) {
        const detRes = await commands.oculpmGetJournalEntry(projectId, e.relative_path);
        if (detRes.status === "ok" && detRes.data) {
          bodies.push(`#### ${detRes.data.title}\n${clampText(detRes.data.body_markdown.trim(), 1200)}`);
        }
      }
      if (bodies.length > 0) md += "\n최근 기록 상세:\n\n" + bodies.join("\n\n");
      sections.push(md);
    }
  }

  const rulesRes = await commands.oculpmAgentsGetMasterTemplate(projectId);
  if (rulesRes.status === "ok" && rulesRes.data.trim()) {
    sections.push(
      "### 작업 규칙 (AGENTS)\n이 프로젝트의 규칙입니다. 응답과 제안은 이 규칙을 따르세요.\n\n" +
        digestRules(rulesRes.data),
    );
  }

  return sections.join("\n\n");
}

export interface AiContextOptions {
  projectId: number | null;
  /** Current user query — seeds the RAG retrieval. */
  query: string;
  settings: Settings;
  includeRag?: boolean;
  includePlanner?: boolean;
  includeGit?: boolean;
  includeOculpm?: boolean;
  /** Append the json:action protocol so the assistant can propose planner
   *  edits (approved via ActionProposalCard). Defaults to `includePlanner`. */
  includeActions?: boolean;
}

export interface AiContextPart {
  key: "system" | "rag" | "planner" | "actions" | "git" | "oculpm";
  /** UI label (토큰 추정 브레이크다운에 표시). */
  label: string;
  /** Raw text of this part — token estimation runs over it. */
  text: string;
}

export interface AiContextResult {
  /** Assembled system-prompt addition (system prompt + project context). */
  system: string;
  /** RAG chunks retrieved (for a "근거" indicator). */
  chunks: ChunkSearchResult[];
  /** Short labels of what got attached, for the UI. */
  attached: string[];
  /** Per-part breakdown, in injection order — 전송 전 토큰 추정용. */
  parts: AiContextPart[];
}

/**
 * One-call context assembly for the main AI panel. Mirrors the order ChatPanel
 * uses (system prompt → code → planner → git → journal) but without the
 * open-file / action-protocol pieces that are specific to the code workbench.
 * Best-effort throughout: a failing source is skipped, never fatal.
 */
export async function assembleAiContext(opts: AiContextOptions): Promise<AiContextResult> {
  const { projectId, query, settings } = opts;
  const includeRag = opts.includeRag ?? settings.ragTopK > 0;
  const includePlanner = opts.includePlanner ?? true;
  const includeGit = opts.includeGit ?? false;
  const includeOculpm = opts.includeOculpm ?? settings.includeOculpmContext;
  const includeActions = opts.includeActions ?? includePlanner;

  const attached: string[] = [];
  const parts: AiContextPart[] = [];
  let chunks: ChunkSearchResult[] = [];

  if (settings.systemPrompt.trim()) {
    parts.push({ key: "system", label: "시스템 프롬프트", text: settings.systemPrompt.trim() });
  }

  if (includeRag && projectId != null && query.trim() && settings.ragTopK > 0) {
    const res = await commands.searchChunks(projectId, query, settings.ragTopK, false);
    if (res.status === "ok" && res.data.length > 0) {
      chunks = res.data;
      parts.push({ key: "rag", label: `코드 ${chunks.length}곳`, text: buildContextSystem(chunks) });
      attached.push(`코드 ${chunks.length}곳`);
    }
  }
  if (includePlanner) {
    const p = await buildPlannerSystemContext(projectId);
    if (p) {
      parts.push({ key: "planner", label: "플래너", text: p });
      attached.push("플래너");
    }
  }
  // The action protocol is cheap (a static instruction) and only useful when
  // the planner is in play, so it follows the planner block.
  if (includeActions) {
    parts.push({ key: "actions", label: "액션 프로토콜", text: buildActionInstruction() });
  }
  if (includeGit) {
    const g = await buildGitSystemContext(projectId);
    if (g) {
      parts.push({ key: "git", label: "git", text: g });
      attached.push("git");
    }
  }
  if (includeOculpm) {
    const o = await buildOculpmSystemContext(projectId, settings.oculpmContextEntries);
    if (o) {
      parts.push({ key: "oculpm", label: "작업일지", text: o });
      attached.push("작업일지");
    }
  }

  const system = parts.map((p) => p.text).join("\n\n").trim();
  return { system, chunks, attached, parts };
}
