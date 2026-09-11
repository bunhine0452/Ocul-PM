/**
 * `notionApi` — Notion 연동의 읽기(상태)와 내보내기. 설정의 연결·검증 흐름은
 * 기존 `DataTab` 이 봉투를 직접 다루고(allowlist), 화면 쪽 트리거는 여기로.
 */
import { call, type Envelope } from "@/api/invoke";
import { commands } from "@/lib/bindings";
import type { NotionStatus } from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const notionApi = {
  status: () => unwrap<NotionStatus>("notion_status", commands.notionStatus()),
  /** 마크다운을 부모 페이지 아래 새 페이지로 — 돌려주는 것은 페이지 URL. */
  export: (projectId: number, title: string, markdown: string) =>
    unwrap<string>("notion_export", commands.notionExport(projectId, title, markdown)),
  /** OS 브라우저로 URL 을 연다 — `open_url` 은 스킴을 백엔드가 검사한다. */
  openUrl: (url: string) => unwrap<null>("open_url", commands.openUrl(url)),
};
