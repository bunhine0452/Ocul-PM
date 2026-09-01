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

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const llmApi = {
  /**
   * 마지막으로 **관측된** 도달성. 프로브를 쏘지 않으므로 목록을 여는 것만으로
   * 네트워크가 나가지 않는다. 한 번도 안 불러 본 프로바이더는 목록에 없다.
   */
  reachability: () => unwrap<ProviderReach[]>("llm_reachability", commands.llmReachability()),
};
