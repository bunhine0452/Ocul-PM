// ⇧⌥F 포맷팅 — `CodePane` 에서 떼어 낸 한 조각.
//
// 이 폴더의 다른 훅들(`useLsp` · `useFileOps` · `useFileHistory` · `useDebug` ·
// `useCodeImport`)과 같은 자리다. 창(pane)이 들고 있던 마지막 인라인 훅이었다.
//
// 이름 바꾸기·코드 액션과 정반대다: 그것들은 디스크를 고치므로 미저장을
// 금지했지만, 포맷은 **지금 버퍼**를 다듬어 돌려받아 그대로 싣는다 — 저장할지는
// 여전히 사용자가 정한다.

import { useCallback, useRef, useState } from "react";

import { toast } from "@/lib/toast";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { FormatRange } from "./CodeEditor";

interface Options {
  /** `useLsp` 의 포맷 호출 (서버가 없으면 `null` 을 준다). */
  format: (
    text: string,
    tabSize: number,
    insertSpaces: boolean,
    range: {
      start_line: number;
      start_character: number;
      end_line: number;
      end_character: number;
    } | null,
  ) => Promise<string | null>;
  tabSize: number;
  insertSpaces: boolean;
  /** 지금 버퍼 본문 — 없으면(미리보기 탭 등) 포맷할 것이 없다. */
  currentText: () => string | null;
  replaceBufferText: (next: string) => void;
}

export function useCodeFormat({
  format,
  tabSize,
  insertSpaces,
  currentText,
  replaceBufferText,
}: Options) {
  const [formatting, setFormatting] = useState(false);

  const run = useCallback(
    async (silent = false, range?: FormatRange): Promise<boolean> => {
      const text = currentText();
      if (text == null || formatting) return false;
      setFormatting(true);
      try {
        const next = await format(
          text,
          tabSize,
          insertSpaces,
          range
            ? {
                start_line: range.startLine,
                start_character: range.startCharacter,
                end_line: range.endLine,
                end_character: range.endCharacter,
              }
            : null,
        );
        if (next == null) {
          // 서버가 없거나·지원하지 않거나·이미 정돈됐다. 저장 시 포맷처럼
          // 사람이 부르지 않은 호출은 조용히 지나간다.
          if (!silent) toast.info(t("code.format.noChange"));
          return false;
        }
        replaceBufferText(next);
        if (!silent) toast.info(t("code.format.done"));
        return true;
      } catch (e) {
        toast.destructive(
          t("code.format.failed", { error: tError(e instanceof Error ? e.message : String(e)) }),
        );
        return false;
      } finally {
        setFormatting(false);
      }
    },
    [currentText, format, formatting, insertSpaces, replaceBufferText, tabSize],
  );

  // 저장 경로가 타이머·cleanup 안에서도 부르므로 최신 것을 ref 로 잡아 둔다.
  const ref = useRef(run);
  ref.current = run;

  return { formatting, run, ref };
}
