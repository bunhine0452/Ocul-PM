// 출처 표식 태그 — `journal_write`(MCP) 가 모든 일지에 자동으로 붙이는 태그
// (플랜 `journal-scale-round` {#tag-source-marker}). 백엔드 짝은
// `src-tauri/src/oculpm/spec.rs` 의 `SOURCE_MARKER_TAGS` — 값이 바뀌면 양쪽을
// 같이 고친다.
//
// 사람이 고른 태그가 아니라 **누가 기록했는가**의 신호라, 태그 칩·필터에서는
// 뺀다 — 그 사실은 이미 `SourceBadge`(`source: "mcp"`, `entrySource.ts`)가
// 따로 보여준다. 이 저장소 표본은 일지 727건 중 431건에 붙어 있어, 빼지
// 않으면 원장의 모든 태그 목록·통계가 이 하나로 뒤덮인다.

export const SOURCE_MARKER_TAGS: readonly string[] = ["mcp-tool"];

export function isSourceMarkerTag(tag: string): boolean {
  return SOURCE_MARKER_TAGS.includes(tag);
}

/** 칩으로 그릴 태그만 — 출처 표식은 뺀다. */
export function visibleTags(tags: readonly string[]): string[] {
  return tags.filter((t) => !isSourceMarkerTag(t));
}
