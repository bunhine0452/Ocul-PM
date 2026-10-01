// 언어 서버 커맨드·이벤트 래퍼 (2026-10-01 `{#api-facades}`).
//
// 백엔드가 서버 프로세스·프로토콜을 다 맡는다. 화면(`useLsp` 와 그 조각들,
// 설정의 코드 탭, ⌘K 팔레트)은 여기만 지난다. `call` 이 봉투를 풀어 실패를
// `ApiError` 하나로 접으므로, 읽기 기능은 `.catch` 로 로그만 남기고 파일을
// 고치는 기능(포맷·코드 액션·이름 바꾸기)은 그대로 던져 호출자가 토스트를 띄운다.
import {
  commands,
  events,
  type LspDiagnosticsPublished,
  type LspFormatRange,
  type LspServerStateChanged,
} from "@/lib/bindings";
import { call, subscribe } from "./invoke";

export const lspApi = {
  // ── 수명 ────────────────────────────────────────────────────────────────
  /** 이 파일을 서버에 연다. LSP 대상이 아닌 파일이면 `false` (오류 아님). */
  open: (projectId: number, path: string, text: string) =>
    call("lsp_open", commands.lspOpen(projectId, path, text)),
  change: (projectId: number, path: string, text: string) =>
    call("lsp_change", commands.lspChange(projectId, path, text)),
  close: (projectId: number, path: string) => call("lsp_close", commands.lspClose(projectId, path)),

  // ── 읽기 ────────────────────────────────────────────────────────────────
  completion: (projectId: number, path: string, line: number, character: number) =>
    call("lsp_completion", commands.lspCompletion(projectId, path, line, character)),
  hover: (projectId: number, path: string, line: number, character: number) =>
    call("lsp_hover", commands.lspHover(projectId, path, line, character)),
  definition: (projectId: number, path: string, line: number, character: number) =>
    call("lsp_definition", commands.lspDefinition(projectId, path, line, character)),
  references: (projectId: number, path: string, line: number, character: number) =>
    call("lsp_references", commands.lspReferences(projectId, path, line, character)),
  documentSymbols: (projectId: number, path: string) =>
    call("lsp_document_symbols", commands.lspDocumentSymbols(projectId, path)),
  signatureHelp: (projectId: number, path: string, line: number, character: number) =>
    call("lsp_signature_help", commands.lspSignatureHelp(projectId, path, line, character)),
  semanticLegend: (projectId: number, path: string) =>
    call("lsp_semantic_legend", commands.lspSemanticLegend(projectId, path)),
  semanticTokens: (projectId: number, path: string) =>
    call("lsp_semantic_tokens", commands.lspSemanticTokens(projectId, path)),
  codeActions: (
    projectId: number,
    path: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  ) =>
    call(
      "lsp_code_actions",
      commands.lspCodeActions(projectId, path, startLine, startCharacter, endLine, endCharacter),
    ),
  /** 프로젝트 전체의 마지막 진단 — 문제 패널이 처음 열릴 때. */
  diagnosticsSnapshot: (projectId: number) =>
    call("lsp_diagnostics_snapshot", commands.lspDiagnosticsSnapshot(projectId)),
  /** ⌘T 심볼 검색 (워크스페이스 전체). */
  workspaceSymbols: (projectId: number, query: string) =>
    call("lsp_workspace_symbols", commands.lspWorkspaceSymbols(projectId, query)),

  // ── 파일을 고치는 것 ─────────────────────────────────────────────────────
  /** 디스크가 아니라 **넘긴 텍스트**를 다듬어 돌려준다. 바뀐 것이 없으면 `null`. */
  format: (
    projectId: number,
    path: string,
    text: string,
    tabSize: number,
    insertSpaces: boolean,
    range: LspFormatRange | null,
  ) => call("lsp_format", commands.lspFormat(projectId, path, text, tabSize, insertSpaces, range)),
  applyCodeAction: (projectId: number, path: string, index: number) =>
    call("lsp_apply_code_action", commands.lspApplyCodeAction(projectId, path, index)),
  rename: (projectId: number, path: string, line: number, character: number, newName: string) =>
    call("lsp_rename", commands.lspRename(projectId, path, line, character, newName)),

  // ── 서버 관리 (설정 → 코드) ──────────────────────────────────────────────
  status: (projectId: number) => call("lsp_status", commands.lspStatus(projectId)),
  stop: (projectId: number) => call("lsp_stop", commands.lspStop(projectId)),

  // ── 이벤트 ──────────────────────────────────────────────────────────────
  onDiagnostics: (cb: (payload: LspDiagnosticsPublished) => void) =>
    subscribe(events.lspDiagnosticsPublished, cb),
  onServerState: (cb: (payload: LspServerStateChanged) => void) =>
    subscribe(events.lspServerStateChanged, cb),
};
