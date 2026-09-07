import { t } from "@/i18n";
// Final UI Update (ui_v2) — stable per-agent swatch color. Data-driven color is
// explicitly allowed by UI-MASTER-PROMPT §3.1 ("agent 별 색은 데이터로 받음").
// We don't get a color from the backend, so derive a deterministic one from a
// fixed palette keyed by agent id — known agents get a curated hue, unknown
// ids hash into the palette so the swatch stays stable across renders.

const KNOWN: Record<string, string> = {
  // Claude 는 한 값이다 — `--claude` / `CLAUDE_ORANGE` 와 같은 코랄
  // (v3-surface {#claude-coral-unify}). 아래 PALETTE 는 해시 버킷이라
  // 별개다 — 뜻이 다르면 값이 같아도 한 자리에 두지 않는다.
  "claude-code": "#d97757",
  cursor: "#5a7a95",
  "gemini-cli": "#7c5cdb",
  antigravity: "#12a06b",
  pi: "#3a9bb5",
  manual: "#97979d",
  // v2 U4 — 어댑터 확대분 (git 백필 귀속 codex 포함).
  windsurf: "#0e9488",
  copilot: "#64748b",
  codex: "#10a37f",
  aider: "#e0524b",
  cline: "#2563eb",
  zed: "#d9881f",
};

// PALETTE[0] 은 2026-09-07 이전엔 #d97a4f — Claude 코랄(#d97757)과 RGB 거리
// 8.5(1% 차이)·색상환 4도라 "모르는 에이전트" 가 Claude 로 보였다
// ({#palette-claude-collision}). 뜻이 다른 해시 버킷 색이라 코랄로 통일할 수
// 없어, 색상환에서 63도 떨어진 자주(다른 다섯 색과도 최소 51도)로 옮겼다.
const PALETTE = ["#cb4db2", "#5a7a95", "#7c5cdb", "#12a06b", "#d9881f", "#e0524b"];

export function agentColor(agentId: string): string {
  const known = KNOWN[agentId];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Friendly display name for known agent ids; falls back to the raw id. */
export function agentLabel(agentId: string): string {
  const map: Record<string, string> = {
    "claude-code": "Claude Code",
    cursor: "Cursor",
    "gemini-cli": "Gemini CLI",
    antigravity: "Antigravity",
    pi: "Pi",
    manual: t("agent.manual"),
    windsurf: "Windsurf",
    copilot: "GitHub Copilot",
    codex: "Codex CLI",
    aider: "aider",
    cline: "Cline",
    zed: "Zed",
  };
  return map[agentId] ?? agentId;
}

/** Agent label with the reported model appended — "Claude Code · Opus 4.8".
 *  Falls back to just the label when no model/version was recorded. */
export function agentLabelWithModel(agentId: string, version?: string | null): string {
  const base = agentLabel(agentId);
  const v = version?.trim();
  return v ? `${base} · ${v}` : base;
}
