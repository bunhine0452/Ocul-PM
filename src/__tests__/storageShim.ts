/**
 * Web Storage 셰임 — Node 26+ 에서 jsdom 의 `localStorage` 가 가려지는 문제.
 *
 * Node 22 부터 런타임 자체가 실험적 `globalThis.localStorage` / `sessionStorage`
 * 를 들고 다니는데, `--localstorage-file` 없이 뜨면 그 getter 는 **undefined 를
 * 돌려준다**. vitest 의 jsdom 환경은 jsdom window 의 속성을 Node 전역에 복사할 때
 * 이미 전역에 있는 키는 건너뛰므로, 이 자리를 Node 쪽 getter 가 계속 차지하고
 * jsdom 이 만든 진짜 Storage 는 전역에서 닿을 수 없게 된다. 결과적으로
 * `localStorage.clear()` 를 쓰는 스위트가 `Cannot read properties of undefined`
 * 로 전부 죽는다 (2026-08-28 실측: Node 26.7 에서 19파일/201건).
 *
 * CI 는 Node 22 라 초록이어서 이 증상은 로컬에서만 보인다. 개발자의 Node 버전에
 * 상관없이 게이트가 성립해야 하므로, 전역이 비어 있을 때만 메모리 Storage 를
 * 깔아 준다 — 이미 쓸 수 있으면(구버전 Node·실제 브라우저) 손대지 않는다.
 *
 * setup.ts 의 **첫 import** 여야 한다: ESM 은 import 를 선언 순서대로 실행하므로,
 * 모듈 스코프에서 스토리지를 만지는 코드가 나중에 생겨도 셰임이 먼저 선다.
 */

/** jsdom Storage 와 같은 관찰 가능 동작만 구현한다 (키·값 문자열 강제, 없으면 null). */
class MemoryStorage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    const value = this.entries.get(String(key));
    return value === undefined ? null : value;
  }

  setItem(key: string, value: string): void {
    this.entries.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(String(key));
  }

  clear(): void {
    this.entries.clear();
  }
}

function installIfMissing(name: "localStorage" | "sessionStorage"): void {
  // 접근 자체가 던지는 구현(불투명 origin 의 jsdom)도 "없음"으로 친다.
  let usable = false;
  try {
    usable = typeof (globalThis as Record<string, unknown>)[name] === "object" && (globalThis as Record<string, unknown>)[name] !== null;
  } catch {
    usable = false;
  }
  if (usable) return;

  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

installIfMissing("localStorage");
installIfMissing("sessionStorage");
