// OS 키체인 시크릿 커맨드 래퍼 (2026-10-01 `{#api-facades}`).
//
// 값은 키체인에만 산다 — DB·localStorage 에 두지 않는다 (`secrets.rs`). 이름 규약
// (`<provider>_api_key` 등)은 호출자가 정한다.
import { commands } from "@/lib/bindings";
import { call } from "./invoke";

export const secretsApi = {
  /** 있는가 — **캐시된 조회**라 키체인 잠금을 풀지 않는다 (암호를 묻지 않는다). */
  has: (name: string): Promise<boolean> => call("secret_has", commands.secretHas(name)),
  /** 키체인을 실제로 읽어 본다 — 잠겨 있으면 사용자에게 한 번 묻는다. */
  verify: (name: string): Promise<boolean> => call("secret_verify", commands.secretVerify(name)),
  set: (name: string, value: string): Promise<null> => call("secret_set", commands.secretSet(name, value)),
  delete: (name: string): Promise<null> => call("secret_delete", commands.secretDelete(name)),
};
