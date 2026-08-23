/** 문제 해결 화면의 표시 보조 — 상태 pill 과 날짜 표기. 화면과 읽기 뷰가 함께 쓴다. */
import type { I18nKey } from "@/i18n";

const STATUS_META: Record<string, { labelKey: I18nKey; cls: string }> = {
  open: { labelKey: "disc.status.open", cls: "open" },
  resolved: { labelKey: "disc.status.resolved", cls: "resolved" },
  archived: { labelKey: "disc.status.archived", cls: "archived" },
};

/** 알 수 없는 상태는 원문을 그대로 보여준다 — 사전 키가 없으므로 rawLabel 로. */
export function statusMeta(s: string): { labelKey?: I18nKey; rawLabel?: string; cls: string } {
  return STATUS_META[s] ?? { rawLabel: s, cls: "resolved" };
}

/** Short YYYY-MM-DD slice of an ISO/date string. */
export function shortDate(s: string): string {
  return s ? s.slice(0, 10) : "";
}
