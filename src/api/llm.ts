/**
 * `llmApi` — 프로바이더 도달성 (Osaurus 라운드 Phase 7 #model-picker-offline).
 *
 * 채팅 자체는 아직 `commands.chatStream` 직접 호출이다 (스트리밍 Channel 은
 * 봉투 밖으로 나가므로 `call` 래퍼의 모양과 맞지 않는다). 여기 있는 것은
 * 봉투를 쓰는 조회 하나뿐이다.
 */

import { call, type Envelope } from "@/api/invoke";
import { commands } from "@/lib/bindings";
import type { ProviderReach } from "@/lib/bindings";
import type { Provider } from "@/lib/settings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

/** 키체인 시크릿 이름 규약 (`secrets.rs` 가 이 이름으로 저장한다). */
const secretName = (p: Provider): string => `${p}_api_key`;

export const llmApi = {
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
};
