// ⌘K 인라인 편집의 **화면 쪽 배선** — 모델 호출과 귀속.
//
// `CodePane` 에서 떼어 낸 이유는 크기 하나가 아니다. 이 셋은 서로 붙어 있고
// (어느 모델이 답했나 → 몇 곳을 고쳤나 → 일지에 무엇을 적나) 편집 창의 다른
// 관심사(버퍼·탭·충돌·LSP 수명)와는 안 붙어 있다.
//
// `useConfirm` 과 같은 모양이다 — 상태와 함께 **그릴 것**(`chip`)까지 돌려준다.

import { useCallback, useRef, useState } from "react";

import { llmApi } from "@/api/llm";
import { oculpmApi } from "@/api/oculpm";
import { parseFallbacks, providerModel, type Provider, type Settings } from "@/lib/settings";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import { addEdit, buildDraft, type AiEditTally } from "./attribution";
import type { ChatMessage } from "./prompt";

interface Options {
  projectId: number;
  settings: Settings;
  /** 지금 창에 열려 있는 파일. 없으면 칩도 없다. */
  activePath: string | null;
}

export function useCodeAi({ projectId, settings, activePath }: Options) {
  const provider = settings.coreProvider as Provider;
  const model = providerModel(settings, provider);

  /**
   * 모델 호출 — **ACP 가 아니라 프로바이더 채팅**이다.
   *
   * ACP(Claude Code · Codex)는 세션 · 한 번에 한 턴 · 에이전트가 자기 도구로
   * 디스크를 고치는 것을 전제한다. ⌘K 는 "이 선택을 고쳐 **텍스트로** 돌려
   * 달라" 라 모양이 다르고, 게다가 편집기에는 아직 저장 안 한 버퍼가 있다 —
   * 에이전트가 디스크를 고치면 그 둘이 싸운다.
   *
   * `temperature: 0` — 같은 지시에 같은 답이 나와야 되돌리고 다시 해 볼 수 있다.
   */
  const run = useCallback(
    async (messages: ChatMessage[]): Promise<string> => {
      const res = await llmApi.chat(
        provider,
        messages,
        { model, temperature: 0, max_tokens: null },
        parseFallbacks(settings),
      );
      return res.content;
    },
    [model, provider, settings],
  );

  /** 파일별 누적 — 칩과 일지 초안이 같은 값을 읽는다. */
  const [tallies, setTallies] = useState<Map<string, AiEditTally>>(() => new Map());
  /**
   * 아직 저장까지 안 간 ⌘K 편집을 들고 있는 파일들 — 로컬 히스토리의 출처가
   * 이걸 읽는다.
   *
   * 위의 `tallies` 와 **다른 축**이라 따로 둔다: 저 쪽은 "일지에 아직 안 적은"
   * 이고 이쪽은 "디스크에 아직 안 쓴" 이다. 저장이 일지를 지우지 않고, 일지가
   * 저장을 지우지 않는다.
   */
  const unsavedAi = useRef(new Set<string>());
  const onAccepted = useCallback(
    (path: string | null, info: { added: number; removed: number }) => {
      if (!path) return;
      unsavedAi.current.add(path);
      setTallies((prev) => {
        const next = new Map(prev);
        next.set(path, addEdit(prev.get(path), info, provider, model));
        return next;
      });
    },
    [model, provider],
  );

  /**
   * 이 파일을 지금 저장하면 **에이전트가 쓴 글자**가 함께 나가는가.
   *
   * 읽으면 지운다 — 저장이 끝난 뒤의 다음 판은 다시 사람 것이다. 사람이 그
   * 뒤에 손으로 더 고쳤어도 이 판에는 AI 문장이 들어 있으므로 `Agent` 가 맞다
   * ("이 판에 AI 글자가 있는가" 를 묻는 것이지 "전부 AI 인가" 가 아니다).
   */
  const takeAgentAuthored = useCallback((path: string | null) => {
    if (!path) return false;
    return unsavedAi.current.delete(path);
  }, []);

  const [recording, setRecording] = useState(false);
  const record = useCallback(
    async (path: string) => {
      const tally = tallies.get(path);
      if (!tally || recording) return;
      setRecording(true);
      try {
        await oculpmApi.createManualEntry(projectId, buildDraft(path, tally));
        toast.info(t("code.ai.journalDone"));
        // 남겼으면 누적은 0 으로 — 같은 편집을 두 번 적게 두지 않는다.
        setTallies((prev) => {
          const next = new Map(prev);
          next.delete(path);
          return next;
        });
      } catch (e) {
        toast.destructive(tError(e instanceof Error ? e.message : String(e)));
      } finally {
        setRecording(false);
      }
    },
    [projectId, recording, tallies],
  );

  const tally = activePath ? tallies.get(activePath) : undefined;
  const chip =
    activePath && tally ? (
      <button
        type="button"
        className="code-status-item code-status-ai"
        disabled={recording}
        title={t("code.ai.journal")}
        onClick={() => void record(activePath)}
      >
        {t("code.ai.recorded", { count: String(tally.edits) })}
      </button>
    ) : null;

  return { run, onAccepted, takeAgentAuthored, chip };
}
