/**
 * 디자인 스위트 두 벌이 함께 쓰는 파일 헬퍼.
 *
 * `design_tokens.test.ts`(계약)와 `design_ratchets.test.ts`(래칫)가 같은
 * 방식으로 `src/` 를 훑는다. 쪼갠 이유는 크기 래칫이 810줄에서 막았기
 * 때문이고, 쪼갠 **자리**는 크기가 아니라 뜻이 정했다 — 계약은 "참이어야
 * 하는 것", 래칫은 "나빠지지 않아야 하는 것" 이라 고치는 방법이 다르다.
 * 계약이 깨지면 코드를 고치고, 래칫이 걸리면 숫자를 내려 적거나 코드를
 * 고친다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(__dirname, "..");
export const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** `src/` 아래의 손으로 쓰는 소스. 테스트와 보존된 죽은 코드는 뺀다. */
export function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "legacy" || name === "__tests__") continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx?|css)$/.test(name)) yield full;
  }
}
