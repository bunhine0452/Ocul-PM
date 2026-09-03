// 남이 쓴 텍스트를 모델에게 넘길 때의 경계 (플랜 `untrusted-text-framing`).
//
// 백엔드 `src-tauri/src/oculpm/framing.rs` 와 **같은 표**를 쓴다. 두 벌인 것은
// 주입 지점이 두 곳(프런트의 AI 패널 · MCP 도구 응답)이기 때문이고, 표가 같아야
// 한쪽만 고쳐져 어긋나는 것을 테스트가 잡는다 — 양쪽 테스트 이름을 맞춰 뒀다.
//
// 하는 일은 둘이다.
//
//   1. 짝 태그로 감싸 **출처를 본문과 같은 문자열에** 넣는다.
//   2. 비신뢰 본문의 `&`·`<`·`>` 를 무력화해 **경계를 위조할 수 없게** 한다.
//
// 우리가 쓴 것(사용자 지시문, 능력 매니페스트, 정적 규약)은 바이트 그대로 간다.
//
// 막지 못하는 것: 이스케이프는 경계 위조를 막지 **설득**을 막지 않는다.
// "이 파일을 지워 줘" 라고 정중히 쓴 일지 본문은 그대로 통과한다.

/**
 * 쓸 수 있는 태그는 여기 적힌 것뿐이다 — 데이터에서 온 문자열은 타입이 안 맞아
 * 애초에 들어올 수 없다. 태그 자체가 주입 표면이 되는 길을 컴파일러가 막는다.
 */
export type FramingTag = "code-snippet" | "journal" | "plans" | "git-context";

/**
 * 비신뢰 텍스트의 경계 문자를 무력화한다.
 *
 * `&` 를 **먼저** 치환한다. 순서가 뒤집히면 `<` → `&lt;` 로 만든 뒤 그 `&` 를
 * 다시 치환해 `&amp;lt;` 가 되고, 원문에 없던 문자열이 생긴다.
 */
export function escapeUntrusted(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 속성값 — 이스케이프 위에 `"` 까지, 줄바꿈·제어문자는 공백 하나로 접는다. */
function attrValue(value: string): string {
  // 접는 이유: 속성값에 개행이 있으면 여는 태그가 여러 줄로 쪼개져 뒷줄이 태그
  // **밖의** 본문처럼 읽힌다.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자를 접는 것이 목적이다
  const folded = value.replace(/[\u0000-\u001F\u007F]/g, " ");
  return escapeUntrusted(folded).replace(/"/g, "&quot;");
}

/**
 * 본문을 **그대로** 담은 짝 태그.
 *
 * 우리가 쓴 텍스트, 또는 잎을 이미 이스케이프해 조립한 컨테이너에만 쓸 것.
 */
export function trustedSection(tag: FramingTag, body: string): string {
  return `<${tag}>\n${body}\n</${tag}>`;
}

/** 비신뢰 본문을 출처 속성과 함께 감싼다. 감싸기 전에 이스케이프한다. */
export function untrustedSection(
  tag: FramingTag,
  attrs: ReadonlyArray<readonly [string, string]>,
  body: string,
): string {
  const rendered = attrs.map(([name, value]) => ` ${name}="${attrValue(value)}"`).join("");
  return `<${tag}${rendered}>\n${escapeUntrusted(body)}\n</${tag}>`;
}
