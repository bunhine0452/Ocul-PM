/**
 * `llmApi` — 프로바이더 도달성 + **한 번짜리** 채팅.
 *
 * 스트리밍 채팅(`commands.chatStream`)은 여전히 직접 호출이다: Channel 이 봉투
 * 밖으로 나가므로 `call` 래퍼의 모양과 맞지 않는다. 반대로 한 번짜리 `chat` 은
 * 봉투 그대로라 여기 산다 (⌘K 인라인 편집이 쓴다).
 */

import { call, type Envelope } from "@/api/invoke";
import { commands } from "@/lib/bindings";
import type { ChatOptions, ChatResponse, Message, ModelInfo, ProviderModel, ProviderReach } from "@/lib/bindings";
import type { Provider } from "@/lib/settings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

/** 키체인 시크릿 이름 규약 (`secrets.rs` 가 이 이름으로 저장한다). */
const secretName = (p: Provider): string => `${p}_api_key`;

export const llmApi = {
  /** 이 키로 쓸 수 있는 모델 목록 (설정 → LLM 의 datalist). 키가 없으면 실패. */
  listModels: (provider: Provider) => unwrap<ModelInfo[]>("llm_list_models", commands.llmListModels(provider)),

  /**
   * 마지막으로 **관측된** 도달성. 프로브를 쏘지 않으므로 목록을 여는 것만으로
   * 네트워크가 나가지 않는다. 한 번도 안 불러 본 프로바이더는 목록에 없다.
   */
  reachability: () => unwrap<ProviderReach[]>("llm_reachability", commands.llmReachability()),

  /**
   * 이 프로바이더의 API 키가 키체인에 **있는가**. 캐시된 조회라 키체인 잠금을
   * 풀지 않는다 (사용자에게 암호를 묻지 않는다).
   *
   * `null` 은 "없음" 이 아니라 **"못 읽었다"** 다. 둘을 섞으면 키체인이 잠깐
   * 안 열렸을 때 화면이 "키 없음" 으로 단정해 멀쩡한 모델을 잠근다.
   */
  hasKey: (p: Provider): Promise<boolean | null> =>
    unwrap<boolean>("secret_has", commands.secretHas(secretName(p))).catch(() => null),

  /**
   * 한 번 묻고 한 번 받는다 — 스트리밍이 아니다.
   *
   * ⌘K 인라인 편집이 쓴다. 거기서는 글자가 흘러 들어오는 것이 값이 아니라
   * **완성된 대체 텍스트**가 값이고, 부분 응답을 코드에 끼워 넣으면 그 사이
   * 파일이 깨진 상태로 있게 된다.
   */
  chat: (
    provider: Provider,
    messages: Message[],
    options: ChatOptions,
    fallbacks: ProviderModel[],
  ): Promise<ChatResponse> =>
    unwrap<ChatResponse>("chat", commands.chat(provider, messages, options, fallbacks)),
};
