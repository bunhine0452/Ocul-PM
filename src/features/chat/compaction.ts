// 컨텍스트 압축 한 줄 — `_meta.contextCompaction` 을 사람 말로 (acp-adapter-0751
// `{#carry-compaction}`).
//
// 어댑터는 압축을 `think` 도구 호출("Compact conversation")로 접어 보낸다. 그
// 그대로 그리면 "생각 · Compact conversation" 이라는 줄이 남고, 몇 토큰이
// 줄었는지는 아무 데도 없다. 여기서 숫자를 문장으로 만든다 — 렌더러는 이 한
// 줄만 제목 자리에 놓는다.

import type { AcpCompaction } from "@/lib/bindings";
import type { I18nKey, TVars } from "@/i18n";

type T = (key: I18nKey, vars?: TVars) => string;

/** 토큰 수를 짧게 — 128000 → "128k", 950 → "950", 1_250_000 → "1.25M". */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(2))}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${trimZero((n / 1000).toFixed(1))}k`;
  return String(n);
}

function trimZero(s: string): string {
  return s.replace(/\.?0+$/, "");
}

/**
 * 압축 줄의 제목 문장.
 *
 * - 돌고 있으면 "대화를 접는 중" — 아직 숫자가 없다.
 * - 끝났고 앞뒤 토큰이 있으면 "128k → 42k 토큰 (−67%) · 자동 · 2.3초".
 * - 실패면 사유.
 * - 숫자 없이 끝났으면(SDK 가 빼먹은 경우) 방아쇠만.
 */
export function compactionSummary(c: AcpCompaction, status: string, t: T): string {
  if (status === "failed" || c.error) {
    return c.error ? t("acp.compaction.failedWith", { error: c.error }) : t("acp.compaction.failed");
  }
  if (status === "in_progress" || status === "pending") return t("acp.compaction.running");
  const parts: string[] = [];
  if (c.pre_tokens != null && c.post_tokens != null) {
    const pct = c.pre_tokens > 0 ? Math.round((1 - c.post_tokens / c.pre_tokens) * 100) : 0;
    parts.push(
      t("acp.compaction.tokens", {
        pre: fmtTokens(c.pre_tokens),
        post: fmtTokens(c.post_tokens),
        pct: pct,
      }),
    );
  } else if (c.pre_tokens != null) {
    parts.push(t("acp.compaction.tokensPreOnly", { pre: fmtTokens(c.pre_tokens) }));
  }
  if (c.trigger === "automatic") parts.push(t("acp.compaction.auto"));
  else if (c.trigger === "manual") parts.push(t("acp.compaction.manual"));
  if (c.duration_ms != null) {
    parts.push(t("acp.compaction.duration", { sec: trimZero((c.duration_ms / 1000).toFixed(1)) }));
  }
  return parts.length ? parts.join(" · ") : t("acp.compaction.done");
}
