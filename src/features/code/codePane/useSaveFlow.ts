// 저장 경로 — 저장 위생 · ⌘S(창 레벨) · 자동 저장(떠난 경로 flush 포함) · 충돌 해소.
// `CodePane.tsx` 에서 그대로 들어냈다 (순수 이동). 훅·효과 순서는 원본 그대로다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";

import { commands } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { Settings } from "@/lib/settings";

import { applyHygiene, hygieneForPath, type HygieneOptions } from "../saveHygiene";
import { useAutoSave } from "../autoSave";
import { bufferKey, getBuffer, putBuffer, restoreEol, type CodeBuffer } from "../codeBuffers";
import type { useCodeFormat } from "../useCodeFormat";
import type { useCodeAi } from "../inlineEdit/useCodeAi";
import type { DiffMode, FileView } from "./types";

interface Args {
  projectId: number;
  settings: Settings;
  activePath: string | null;
  isFocused: boolean;
  formatRef: ReturnType<typeof useCodeFormat>["ref"];
  replaceBufferText: (text: string) => void;
  applySaved: (path: string, hash: string) => void;
  loadFile: (path: string, opts?: { discardBuffer?: boolean }) => Promise<void>;
  onBuffersChanged: () => void;
  bufferRef: React.RefObject<CodeBuffer | null>;
  pathRef: React.RefObject<string | null>;
  cursorRef: React.RefObject<{ line: number; col: number }>;
  codeAiRef: React.RefObject<ReturnType<typeof useCodeAi>>;
  conflict: { diskHash: string } | null;
  setConflict: React.Dispatch<React.SetStateAction<{ diskHash: string } | null>>;
  diffMode: DiffMode | null;
  fileView: FileView;
  /** 자동 저장의 타자 트리거 — `handleChange` 가 이 ref 를 부른다. */
  onEditRef: React.RefObject<() => void>;
}

export function useSaveFlow({
  projectId,
  settings,
  activePath,
  isFocused,
  formatRef,
  replaceBufferText,
  applySaved,
  loadFile,
  onBuffersChanged,
  bufferRef,
  pathRef,
  cursorRef,
  codeAiRef,
  conflict,
  setConflict,
  diffMode,
  fileView,
  onEditRef,
}: Args) {
  const [saving, setSaving] = useState(false);

  // ── 저장 위생 ──────────────────────────────────────────────────────────
  // 설정을 ref 로 잡는 이유: 저장은 타이머·cleanup 안에서도 돌고, 그때 필요한
  // 것은 "저장을 부른 순간의 설정" 이다.
  const hygieneOptions = useMemo<HygieneOptions>(
    () => ({
      trimTrailingWhitespace: settings.codeTrimTrailingWhitespace,
      insertFinalNewline: settings.codeInsertFinalNewline,
      trimFinalNewlines: settings.codeTrimFinalNewlines,
      protectedLines: [],
    }),
    [
      settings.codeTrimTrailingWhitespace,
      settings.codeInsertFinalNewline,
      settings.codeTrimFinalNewlines,
    ],
  );
  const hygieneRef = useRef(hygieneOptions);
  hygieneRef.current = hygieneOptions;

  // ⌘S 는 CM 키맵과 화면 레벨 리스너 양쪽에 걸릴 수 있는데, `saving` state 는
  // 같은 틱의 두 번째 호출에 아직 낡은 값이라 재진입을 못 막는다 — 같은
  // base_hash 로 codeWrite 가 두 번 나가면 두 번째가 가짜 충돌 배너를 띄운다.
  const savingRef = useRef(false);
  // 자동 저장이 반복 실패하는 경로 — 토스트를 한 번만 낸다. 사용자가 부르지
  // 않은 동작이 1초마다 같은 말을 하면 그건 알림이 아니라 소음이다.
  const autoFailedRef = useRef<Set<string>>(new Set());
  const save = useCallback(
    async (opts?: { baseHash?: string; auto?: boolean }) => {
      const path = pathRef.current;
      const auto = opts?.auto === true;
      if (!bufferRef.current || !path || savingRef.current) return;
      if (bufferRef.current.text === bufferRef.current.baseText && !opts?.baseHash) return; // no-op
      savingRef.current = true;
      setSaving(true);
      try {
        // 저장 시 포맷 — **쓰기 전에** 다듬는다. 쓴 뒤에 고치면 저장 직후 다시
        // dirty 가 되어 무엇이 디스크에 있는지 알 수 없다. 조용히(silent) 돌려
        // 서버가 없거나 이미 정돈된 경우에 토스트를 내지 않는다.
        //
        // 자동 저장은 포맷을 **건너뛴다** — VS Code 가 정확히 그렇게 한다
        // (`saveParticipants.ts` 의 `if (context.reason === SaveReason.AUTO) return`).
        // 타자 도중 1초마다 포매터가 도는 것은 편집기가 아니라 방해다.
        if (settings.codeFormatOnSave && !auto) await formatRef.current(true);
        // 포맷이 본문을 갈아끼웠을 수 있으므로 **여기서 다시 읽는다**.
        const buf = bufferRef.current;
        if (!buf) return;
        // 저장 시 정리 — 자동 저장이면 커서 줄을 보호한다(커서가 튀지 않게).
        const tidied = applyHygiene(
          buf.text,
          hygieneForPath(path, {
            ...hygieneRef.current,
            protectedLines: auto ? [cursorRef.current.line] : [],
          }),
        );
        if (tidied !== buf.text) replaceBufferText(tidied);
        const target = bufferRef.current;
        if (!target) return;
        const res = await commands.codeWrite(
          projectId,
          path,
          restoreEol(target.text, target.eol),
          opts?.baseHash ?? target.baseHash,
          // ⌘K 가 쓴 문장이 이 판에 들어 있으면 로컬 히스토리에 **에이전트**로
          // 적힌다. 저장을 누른 손이 아니라 글자를 쓴 손이 기준이다.
          codeAiRef.current.takeAgentAuthored(path),
        );
        if (res.status === "error") {
          // 자동 저장의 쓰기 실패(권한 등)는 경로당 한 번만 알린다.
          if (auto && autoFailedRef.current.has(path)) return;
          if (auto) autoFailedRef.current.add(path);
          toast.destructive(t("code.saveFailed", { error: tError(res.error) }));
          return;
        }
        autoFailedRef.current.delete(path);
        if (res.data.kind === "saved") {
          applySaved(path, res.data.hash);
        } else {
          // 충돌은 배너만 — 자동 저장이 토스트를 쏘지 않는다 (D7: 남의 작업을
          // 덮는 경로는 없고, 사용자는 배너에서 고르면 된다).
          setConflict({ diskHash: res.data.disk_hash });
        }
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    // `formatRef` 는 훅이 돌려준 ref 라 신원이 안 바뀌지만, 컴포넌트 밖에서
    // 왔으므로 린터는 그걸 모른다 — 적어 두는 편이 규칙을 끄는 것보다 낫다.
    [
      projectId,
      applySaved,
      replaceBufferText,
      settings.codeFormatOnSave,
      formatRef,
      pathRef,
      bufferRef,
      cursorRef,
      codeAiRef,
      setConflict,
    ],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  // 창 레벨 ⌘S — 트리/필터에 포커스가 있어도 저장된다 (편집면 안이면 편집기의
  // 액션이 먼저 먹는다). 분할 중이면 **포커스된 창만** 반응한다 — 안 그러면
  // 한 번의 ⌘S 가 양쪽에서 저장을 쏜다.
  const focusedRef = useRef(isFocused);
  focusedRef.current = isFocused;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 편집기 액션이 이미 처리한 ⌘S (preventDefault 됨) — 여기서 또 부르면
      // 같은 base_hash 로 저장이 두 번 나간다.
      if (e.defaultPrevented || !focusedRef.current) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── 자동 저장 ──────────────────────────────────────────────────────────
  /**
   * 화면을 떠난 경로를 조용히 저장한다 (탭 전환·창 정리).
   *
   * 이 창의 state 를 건드리지 않는다 — 충돌 배너·저장 중 표시는 **지금 보이는
   * 파일**의 것이다. 충돌하면 버퍼를 그대로 두고 지나간다: 탭 배지가 미저장으로
   * 남아, 사용자가 그 파일로 돌아오면 평소의 배너로 만난다.
   */
  const flushPath = useCallback(
    (path: string) => {
      const key = bufferKey(projectId, path);
      const buf = getBuffer(key);
      if (!buf || buf.text === buf.baseText) return;
      // 떠난 파일에는 커서가 없다 — 보호할 줄도 없다.
      const text = applyHygiene(buf.text, hygieneForPath(path, hygieneRef.current));
      void (async () => {
        const res = await commands.codeWrite(
          projectId,
          path,
          restoreEol(text, buf.eol),
          buf.baseHash,
          codeAiRef.current.takeAgentAuthored(path),
        );
        if (res.status !== "ok" || res.data.kind !== "saved") return;
        // 쓰는 사이에 그 버퍼가 또 바뀌었으면(다시 열어 고쳤다) 덮지 않는다.
        const latest = getBuffer(key);
        if (!latest || latest.text !== buf.text) return;
        putBuffer(key, { ...latest, text, baseText: text, baseHash: res.data.hash });
        onBuffersChanged();
      })();
    },
    [projectId, onBuffersChanged, codeAiRef],
  );

  const autoSave = useAutoSave({
    mode: settings.codeAutoSave,
    delayMs: settings.codeAutoSaveDelay,
    activePath,
    isFocused,
    // 하나라도 걸리면 조용히 건너뛴다. 충돌 배너가 떠 있는 동안 자동으로
    // 덮어쓰지 않고(D7), 인라인 비교 중에는 사용자가 읽는 중이다.
    canAutoSave: () =>
      bufferRef.current != null &&
      bufferRef.current.text !== bufferRef.current.baseText &&
      !savingRef.current &&
      conflict == null &&
      diffMode == null &&
      fileView.kind === "editor",
    saveActive: () => void saveRef.current({ auto: true }),
    flushPath,
  });
  onEditRef.current = autoSave.onEdit;
  const autoSaveOn = settings.codeAutoSave !== "off";

  // ── 충돌 해소 ──────────────────────────────────────────────────────────
  const reloadFromDisk = useCallback(() => {
    const path = pathRef.current;
    if (!path) return;
    void loadFile(path, { discardBuffer: true });
  }, [loadFile, pathRef]);

  const overwriteDisk = useCallback(() => {
    if (!conflict) return;
    void save({ baseHash: conflict.diskHash });
  }, [conflict, save]);

  return { saving, saveRef, autoSave, autoSaveOn, reloadFromDisk, overwriteDisk };
}
