import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  commands,
  events,
  type LspCompletionItem,
  type LspFormatRange,
  type LspDiagnostic,
  type LspCodeAction,
  type LspHover,
  type LspLocation,
  type LspReferenceFile,
  type LspRenameResult,
  type LspSignatureHelp,
  type LspSymbol,
  type LspServerState,
} from "@/lib/bindings";
import { safeUnlisten } from "@/lib/unlisten";
import { oculpmLog } from "@/lib/oculpmLog";

// 코드 화면 ↔ 언어 서버. 백엔드가 프로세스·프로토콜을 다 맡으므로 여기서는
// **수명(열기/편집/닫기)** 과 **이벤트 구독** 만 한다.

/** 편집이 멈춘 뒤 서버에 밀어 넣기까지. 타자 한 번마다 보내면 서버가 재분석을
 *  계속 취소하느라 진단이 영영 안 온다. */
const PUSH_DEBOUNCE_MS = 400;

export interface LspStatus {
  state: LspServerState | null;
  detail: string | null;
}

export interface UseLspResult {
  /** 지금 열린 파일의 진단. 파일이 바뀌면 즉시 비워진다. */
  diagnostics: LspDiagnostic[];
  status: LspStatus;
  /** CM6 완성 소스가 부른다. 서버가 없으면 빈 배열. */
  complete: (line: number, character: number) => Promise<LspCompletionItem[]>;
  /** 커서 위치의 타입·문서. 보여줄 것이 없으면 null. */
  hover: (line: number, character: number) => Promise<LspHover | null>;
  /** 커서 위치 심볼의 정의. 프로젝트 밖이면 `path` 가 null 인 위치가 온다. */
  definition: (line: number, character: number) => Promise<LspLocation | null>;
  /** 커서(또는 선택)에서 쓸 수 있는 코드 액션. */
  codeActions: (
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  ) => Promise<LspCodeAction[]>;
  /** 목록의 `index` 번째를 적용. 파일을 고치므로 호출 전에 미저장 게이트를 건다. */
  applyCodeAction: (index: number) => Promise<LspRenameResult | null>;
  /** 편집이 있을 때마다 호출 — 내부에서 디바운스한다. */
  pushText: (text: string) => void;
  /**
   * 디바운스를 건너뛰고 지금 버퍼를 **즉시** 서버에 밀어 넣는다.
   *
   * 포맷팅 전에 반드시 이걸 부른다: 서버는 자기가 아는 문서를 기준으로 편집
   * 오프셋을 계산하는데, 마지막 타자가 아직 디바운스 안에 있으면 그 문서가
   * 지금 버퍼보다 뒤처져 있어 포맷 결과가 엉뚱한 자리를 건드린다.
   */
  flushText: (text: string) => Promise<void>;
  /** 커서 위치 심볼을 쓰는 모든 곳. 파일별로 묶여서 온다. */
  references: (line: number, character: number) => Promise<LspReferenceFile[]>;
  /** 지금 파일의 구조 (아웃라인). */
  documentSymbols: () => Promise<LspSymbol[]>;
  /** 인자 입력 중의 시그니처. 보여줄 것이 없으면 null. */
  signatureHelp: (line: number, character: number) => Promise<LspSignatureHelp | null>;
  /**
   * 포맷팅 — 디스크가 아니라 **넘긴 텍스트**를 다듬어 돌려준다. 바뀐 것이
   * 없으면 null (서버 없음·이미 정돈됨 포함). `range` 가 있으면 그 범위만.
   */
  format: (
    text: string,
    tabSize: number,
    insertSpaces: boolean,
    range?: LspFormatRange | null,
  ) => Promise<string | null>;
}

/**
 * `path` 파일에 대해 언어 서버를 붙인다.
 *
 * `path` 가 바뀌면 이전 파일을 닫고 새 파일을 연다. LSP 대상이 아닌 파일
 * (css·md 등)은 백엔드가 `false` 를 돌려주고 여기서는 조용히 아무것도 안 한다 —
 * 그런 파일을 열 때마다 오류가 뜨면 안 된다.
 */
export function useLsp(
  projectId: number,
  path: string | null,
  initialText: string,
  /** 내용이 실제로 로드된 순간을 가리키는 신호 (에디터 재마운트와 같은 값).
   *  파일을 고른 순간에 열면 서버가 빈 문서를 보고 엉뚱한 진단을 낸다. */
  epoch: number,
): UseLspResult {
  const [diagnostics, setDiagnostics] = useState<LspDiagnostic[]>([]);
  const [status, setStatus] = useState<LspStatus>({ state: null, detail: null });

  // 이벤트 핸들러가 최신 path 를 봐야 하는데, 구독은 한 번만 건다.
  const pathRef = useRef(path);
  pathRef.current = path;
  // 서버가 붙은 파일인지 — 안 붙었으면 change 를 보내지 않는다.
  const attachedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  /**
   * 이 훅이 실패를 말하는 유일한 방식 (v2.42.0 `{#floating-promises}`).
   *
   * 여기 오는 경로 중 하나(`lspChange`)는 **버퍼 편집마다** 돈다 — 토스트를
   * 띄우면 타자 한 번이 알림 더미가 된다. 그래서 화면에는 이미 있는 상태줄
   * (`status`)로 한 번만 말하고, 원문은 `oculpm.log` 로 내린다. 이미 실패로
   * 서 있으면 상태를 그대로 둔다 (같은 오류가 렌더를 반복하지 않게).
   *
   * 조용히 흘리면 무엇이 사라지나: 서버의 문서가 버퍼보다 뒤처진 채 남아
   * 진단이 엉뚱한 줄에 붙고, 포맷이 다른 자리를 고친다.
   */
  const noteFailure = useCallback((what: string, error: string) => {
    oculpmLog.error("lsp", `${what} failed: ${error}`, { path: pathRef.current });
    setStatus((prev) => (prev.state === "failed" ? prev : { state: "failed", detail: error }));
  }, []);

  // ── 파일 열기/닫기 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!path) {
      setDiagnostics([]);
      setStatus({ state: null, detail: null });
      attachedRef.current = false;
      return;
    }
    // 파일이 바뀌면 이전 파일의 진단을 즉시 버린다 — 남아 있으면 새 파일의
    // 엉뚱한 줄에 밑줄이 붙는다.
    setDiagnostics([]);
    attachedRef.current = false;
    let cancelled = false;

    void (async () => {
      const res = await commands.lspOpen(projectId, path, initialText);
      if (cancelled) return;
      if (res.status === "error") {
        // 오류를 삼키지 않되 토스트로 방해하지도 않는다 — 상태줄이 말한다.
        oculpmLog.error("lsp", `lspOpen failed: ${res.error}`, { path });
        setStatus({ state: "failed", detail: res.error });
        return;
      }
      attachedRef.current = res.data;
    })();

    return () => {
      cancelled = true;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // 닫기는 실패해도 사용자를 막지 않는다 (백엔드가 이미 지워진 파일을
      // 허용한다) — 그래도 조용히 흘리면 서버에 문서가 남은 것을 알 길이 없다.
      void commands.lspClose(projectId, path).then((r) => {
        if (r.status === "error") oculpmLog.error("lsp", `lspClose failed: ${r.error}`, { path });
      });
    };
    // initialText 는 열 때의 값만 필요하다 — 이후 편집은 pushText 가 나른다.
    // 의존성에 넣으면 타자마다 파일을 다시 연다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path, epoch]);

  // ── 편집 밀어넣기 (디바운스) ─────────────────────────────────────────────
  const pushText = useCallback(
    (text: string) => {
      const p = pathRef.current;
      if (!p || !attachedRef.current) return;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void commands.lspChange(projectId, p, text).then((r) => {
          if (r.status === "error") noteFailure("lspChange", r.error);
        });
      }, PUSH_DEBOUNCE_MS);
    },
    [projectId, noteFailure],
  );

  const flushText = useCallback(
    async (text: string) => {
      const p = pathRef.current;
      if (!p || !attachedRef.current) return;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const r = await commands.lspChange(projectId, p, text);
      // 포맷팅이 이걸 기다린다 — 실패를 흘리면 뒤처진 문서에 편집을 건다.
      if (r.status === "error") noteFailure("lspChange", r.error);
    },
    [projectId, noteFailure],
  );

  // ── 이벤트 구독 (마운트 1회) ──────────────────────────────────────────────
  useEffect(() => {
    const offs: Array<() => void> = [];
    let active = true;
    const keep = (off: () => void) => (active ? offs.push(off) : safeUnlisten(off));

    try {
      void events.lspDiagnosticsPublished
        .listen((e) => {
          if (e.payload.project_id !== projectId) return;
          // 지금 보고 있는 파일의 것만 — 서버는 워크스페이스 전체를 진단한다.
          if (e.payload.path !== pathRef.current) return;
          setDiagnostics(e.payload.diagnostics);
        })
        .then(keep)
        .catch(() => {});
      void events.lspServerStateChanged
        .listen((e) => {
          if (e.payload.project_id !== projectId) return;
          setStatus({ state: e.payload.state, detail: e.payload.detail });
        })
        .then(keep)
        .catch(() => {});
    } catch {
      /* jsdom / 비-Tauri — 라이브 갱신만 없다 */
    }
    return () => {
      active = false;
      offs.forEach(safeUnlisten);
    };
  }, [projectId]);

  const complete = useCallback(
    async (line: number, character: number) => {
      const p = pathRef.current;
      if (!p || !attachedRef.current) return [];
      const res = await commands.lspCompletion(projectId, p, line, character);
      if (res.status === "error") {
        oculpmLog.error("lsp", `lspCompletion failed: ${res.error}`, { path: p });
        return [];
      }
      return res.data;
    },
    [projectId],
  );

  // 호버·정의는 모양이 같다 — 붙은 파일에서만 묻고, 실패는 로그로만 남긴다
  // (커서를 올릴 때마다 오류 토스트가 뜨면 편집이 불가능하다).
  const ask = useCallback(
    async <T,>(
      what: string,
      call: (p: string) => Promise<{ status: "ok"; data: T } | { status: "error"; error: string }>,
    ): Promise<T | null> => {
      const p = pathRef.current;
      if (!p || !attachedRef.current) return null;
      const res = await call(p);
      if (res.status === "error") {
        oculpmLog.error("lsp", `${what} failed: ${res.error}`, { path: p });
        return null;
      }
      return res.data;
    },
    [],
  );

  const hover = useCallback(
    (line: number, character: number) =>
      ask("lspHover", (p) => commands.lspHover(projectId, p, line, character)),
    [ask, projectId],
  );

  const definition = useCallback(
    (line: number, character: number) =>
      ask("lspDefinition", (p) => commands.lspDefinition(projectId, p, line, character)),
    [ask, projectId],
  );

  const references = useCallback(
    async (line: number, character: number) =>
      (await ask("lspReferences", (p) =>
        commands.lspReferences(projectId, p, line, character),
      )) ?? [],
    [ask, projectId],
  );

  const documentSymbols = useCallback(
    async () => (await ask("lspDocumentSymbols", (p) => commands.lspDocumentSymbols(projectId, p))) ?? [],
    [ask, projectId],
  );

  const signatureHelp = useCallback(
    (line: number, character: number) =>
      ask("lspSignatureHelp", (p) => commands.lspSignatureHelp(projectId, p, line, character)),
    [ask, projectId],
  );

  // 포맷팅은 파일을 바꾼다 — 읽기 기능들과 달리 실패를 삼키지 않고 던져서
  // 호출자가 토스트를 띄우게 한다 (코드 액션 적용과 같은 태도).
  const format = useCallback(
    async (
      text: string,
      tabSize: number,
      insertSpaces: boolean,
      range?: LspFormatRange | null,
    ) => {
      const p = pathRef.current;
      if (!p || !attachedRef.current) return null;
      await flushText(text);
      const res = await commands.lspFormat(projectId, p, text, tabSize, insertSpaces, range ?? null);
      if (res.status === "error") throw new Error(res.error);
      return res.data;
    },
    [projectId, flushText],
  );

  const codeActions = useCallback(
    async (sl: number, sc: number, el: number, ec: number) =>
      (await ask("lspCodeActions", (p) =>
        commands.lspCodeActions(projectId, p, sl, sc, el, ec),
      )) ?? [],
    [ask, projectId],
  );

  // 적용은 파일을 고친다 — 실패를 삼키지 않고 호출자가 토스트를 띄울 수 있게
  // 오류를 그대로 던진다 (읽기 기능들과 다른 점).
  const applyCodeAction = useCallback(
    async (index: number) => {
      const p = pathRef.current;
      if (!p) return null;
      const res = await commands.lspApplyCodeAction(projectId, p, index);
      if (res.status === "error") throw new Error(res.error);
      return res.data;
    },
    [projectId],
  );

  return useMemo(
    () => ({
      diagnostics,
      status,
      complete,
      hover,
      definition,
      codeActions,
      applyCodeAction,
      pushText,
      flushText,
      references,
      documentSymbols,
      signatureHelp,
      format,
    }),
    [
      diagnostics,
      status,
      complete,
      hover,
      definition,
      codeActions,
      applyCodeAction,
      pushText,
      flushText,
      references,
      documentSymbols,
      signatureHelp,
      format,
    ],
  );
}
