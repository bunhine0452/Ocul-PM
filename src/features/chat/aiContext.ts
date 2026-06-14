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

export async function buildPlannerSystemContext(projectId: number | null): Promise<string> {
  const res = await commands.goalList(projectId, null);
  if (res.status === "error" || !res.data.length) {
    return "";
  }
  let markdown = "### Current Workspace Planner Goals:\n";
  for (const goal of res.data) {
    const priorityText = goal.priority === 2 ? "Urgent" : goal.priority === 1 ? "High" : "Normal";
    const dateText = goal.due_date ? new Date(goal.due_date * 1000).toLocaleDateString() : "No deadline";
    markdown += `- **Goal (ID: ${goal.id})**: ${goal.title} | Status: ${goal.status} | Priority: ${priorityText} | Due: ${dateText}\n`;
    if (goal.description) {
      markdown += `  Description: ${goal.description}\n`;
    }
    const subRes = await commands.subtaskList(goal.id);
    if (subRes.status === "ok" && subRes.data.length) {
      markdown += "  Subtasks:\n";
      for (const sub of subRes.data) {
        markdown += `    - [${sub.done ? "x" : " "}] (ID: ${sub.id}) ${sub.title}\n`;
      }
    }
  }
  return markdown;
}

/** Clamp long text so a single journal body / ruleset can't blow the token
 *  budget. Adds a visible elision marker. */
function clampText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() + "\n… (생략됨)" : s;
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
        clampText(rulesRes.data.trim(), 2500),
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
}

export interface AiContextResult {
  /** Assembled system-prompt addition (system prompt + project context). */
  system: string;
  /** RAG chunks retrieved (for a "근거" indicator). */
  chunks: ChunkSearchResult[];
  /** Short labels of what got attached, for the UI. */
  attached: string[];
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

  let system = "";
  const attached: string[] = [];
  let chunks: ChunkSearchResult[] = [];

  if (settings.systemPrompt.trim()) {
    system += settings.systemPrompt.trim() + "\n\n";
  }

  if (includeRag && projectId != null && query.trim() && settings.ragTopK > 0) {
    const res = await commands.searchChunks(projectId, query, settings.ragTopK, false);
    if (res.status === "ok" && res.data.length > 0) {
      chunks = res.data;
      system += buildContextSystem(chunks) + "\n\n";
      attached.push(`코드 ${chunks.length}곳`);
    }
  }
  if (includePlanner) {
    const p = await buildPlannerSystemContext(projectId);
    if (p) {
      system += p + "\n\n";
      attached.push("플래너");
    }
  }
  if (includeGit) {
    const g = await buildGitSystemContext(projectId);
    if (g) {
      system += g + "\n\n";
      attached.push("git");
    }
  }
  if (includeOculpm) {
    const o = await buildOculpmSystemContext(projectId, settings.oculpmContextEntries);
    if (o) {
      system += o + "\n\n";
      attached.push("작업일지");
    }
  }

  return { system: system.trim(), chunks, attached };
}
