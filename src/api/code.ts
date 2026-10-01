// 트리 파일 조작 커맨드 래퍼 (만들기·이름 바꾸기/옮기기·삭제).
//
// `call` 을 지나므로 화면은 `catch (e)` 하나면 되고, 오류는 `tError` 로 한
// 모양이 된다 (완성도 라운드 #error-convention). `codeHistory.ts` 와 같은 규격.
import {
  commands,
  type CodeAsset,
  type CodeDirListing,
  type CodeFileContent,
  type CodeImportResult,
  type CodePathResult,
  type CodeReplaceOutcome,
  type CodeSearchResult,
  type CodeTree,
  type CodeWriteOutcome,
  type FileJournalEntry,
} from "@/lib/bindings";
import { call } from "./invoke";

export type { CodePathResult };

/** 치환 대상 하나 — 줄은 1-based, 열은 줄 안 UTF-16 0-based. */
export type CodeReplaceTarget = { path: string; line: number; col: number };

export const codeFileApi = {
  /** 빈 파일 하나. 중간 폴더는 따라 생긴다. */
  create: (projectId: number, relPath: string): Promise<CodePathResult> =>
    call("code_create", commands.codeCreate(projectId, relPath)),

  mkdir: (projectId: number, relPath: string): Promise<CodePathResult> =>
    call("code_mkdir", commands.codeMkdir(projectId, relPath)),

  /**
   * 이름 바꾸기 **겸** 옮기기 — 둘은 같은 연산이다 (목적지 경로가 다를 뿐).
   * 옮긴 것이 폴더였는지는 응답이 알려 준다 — 트리 캐시가 낡았을 수 있어
   * 프런트의 판단을 믿지 않는다.
   */
  rename: (projectId: number, fromRel: string, toRel: string): Promise<CodePathResult> =>
    call("code_rename", commands.codeRename(projectId, fromRel, toRel)),

  /** OS 휴지통으로 보낸다 — 영구 삭제가 아니다. */
  delete: (projectId: number, relPath: string): Promise<null> =>
    call("code_delete", commands.codeDelete(projectId, relPath)),
};

/**
 * 편집기 읽기·쓰기·트리·검색 (2026-10-01 `{#api-facades}`) — `CodePane`·코드 화면
 * 조각들·diff 의 새 파일 본문이 쓰던 직접 호출이 여기로 왔다.
 */
export const codeApi = {
  /** 파일 본문 + 해시. 크거나 이진이면 본문 없이 표식만 온다. */
  read: (projectId: number, relPath: string): Promise<CodeFileContent> =>
    call("code_read", commands.codeRead(projectId, relPath)),

  /**
   * 낙관적 잠금 쓰기 — `baseHash` 가 디스크와 다르면 덮지 않고 충돌을 돌려준다.
   * `byAgent` 가 참이면 로컬 히스토리에 **에이전트** 판으로 적힌다(⌘K).
   */
  write: (
    projectId: number,
    relPath: string,
    content: string,
    baseHash: string,
    byAgent: boolean | null,
  ): Promise<CodeWriteOutcome> =>
    call("code_write", commands.codeWrite(projectId, relPath, content, baseHash, byAgent)),

  /** 폴더 한 단계 (지연 펼침). */
  dir: (projectId: number, relPath: string): Promise<CodeDirListing> =>
    call("code_dir", commands.codeDir(projectId, relPath)),

  /** 프로젝트 트리 전체 (gitignore 반영). */
  tree: (projectId: number): Promise<CodeTree> => call("code_tree", commands.codeTree(projectId)),

  /** 이 파일을 건드린 일지들 — 편집기 머리의 칩. */
  fileEntries: (projectId: number, relPath: string): Promise<FileJournalEntry[]> =>
    call("code_file_entries", commands.codeFileEntries(projectId, relPath)),

  /** 미리보기 자산 (이미지·PDF …) — base64. */
  asset: (projectId: number, relPath: string): Promise<CodeAsset> =>
    call("code_asset", commands.codeAsset(projectId, relPath)),

  /** HEAD 의 본문. git 이 아니거나 HEAD 에 없으면 `null`. */
  headContent: (projectId: number, relPath: string): Promise<string | null> =>
    call("code_head_content", commands.codeHeadContent(projectId, relPath)),

  /** 전역 검색 (⇧⌘F). */
  search: (
    projectId: number,
    query: string,
    caseSensitive: boolean,
    wholeWord: boolean,
    isRegex: boolean,
  ): Promise<CodeSearchResult> =>
    call("code_search", commands.codeSearch(projectId, query, caseSensitive, wholeWord, isRegex)),

  /** 전역 치환 — `target` 이 있으면 그 매치 하나만. */
  searchReplace: (
    projectId: number,
    query: string,
    replacement: string,
    caseSensitive: boolean,
    wholeWord: boolean,
    isRegex: boolean,
    paths: string[],
    target: CodeReplaceTarget | null,
  ): Promise<CodeReplaceOutcome> =>
    call(
      "code_search_replace",
      commands.codeSearchReplace(
        projectId,
        query,
        replacement,
        caseSensitive,
        wholeWord,
        isRegex,
        paths,
        target,
      ),
    ),

  /** OS 클립보드에 실린 파일 경로들 (붙여 넣기 가져오기). */
  clipboardFiles: (): Promise<string[]> => call("code_clipboard_files", commands.codeClipboardFiles()),

  /** 바깥 파일·폴더를 `destDir` 아래로 복사해 온다. */
  import: (projectId: number, destDir: string, sources: string[]): Promise<CodeImportResult> =>
    call("code_import", commands.codeImport(projectId, destDir, sources)),

  /** 프로젝트 파일 전체 본문 (검색·diff 의 새 파일). */
  readProjectFile: (projectId: number, relPath: string): Promise<string> =>
    call("read_project_file", commands.readProjectFile(projectId, relPath)),

  /** 줄 범위 (1-based, 양끝 포함). */
  readFileRange: (projectId: number, relPath: string, startLine: number, endLine: number): Promise<string> =>
    call("read_file_range", commands.readFileRange(projectId, relPath, startLine, endLine)),
};
