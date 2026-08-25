// 도구 표시용 공용 맵과 권한 이벤트 타입 — TraceRow·PermissionCard·본체가 함께 쓴다.
//
// AcpConversation.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { ArrowRight, ExternalLink, File as FileIcon, Pencil, Search, Sparkles, Terminal, Trash2 } from "@/components/Icons";
import { type AcpEvent } from "@/lib/bindings";

export type PermissionState = Extract<AcpEvent, { kind: "permission" }>;

/** 도구 종류 → 아이콘. 모르는 종류는 중립 아이콘으로 흘린다. */
export const TOOL_ICON: Readonly<Record<string, typeof FileIcon>> = {
  read: FileIcon,
  edit: Pencil,
  delete: Trash2,
  move: ArrowRight,
  search: Search,
  execute: Terminal,
  think: Sparkles,
  fetch: ExternalLink,
};

/** 상태 → i18n 키. 모르는 상태는 원문 그대로 보여 준다(삼키지 않는다). */
export const TOOL_STATUS_KEY = {
  pending: "acp.tool.status.pending",
  in_progress: "acp.tool.status.inProgress",
  completed: "acp.tool.status.completed",
  failed: "acp.tool.status.failed",
} as const;
