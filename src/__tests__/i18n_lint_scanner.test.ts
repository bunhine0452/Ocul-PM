import { describe, expect, it } from "vitest";

// @ts-expect-error — 빌드 대상이 아닌 zero-dep 검사 스크립트 (.mjs, 타입 없음).
import { scanSource } from "../../scripts/check-no-hardcoded-korean.mjs";

// 한글 하드코딩 게이트의 스캐너 자체 계약
// (docs/20260811_three-features/03-i18n.md §5).
//
// 이 검사기가 Phase 2 진척의 유일한 측정 수단이자 회귀 방지 장치다. 스캐너가
// 조용히 놓치면 게이트가 뚫린 줄도 모른 채 "영어 모드에 한글 잔존" 으로 돌아온다.
// 그래서 놓침(false negative)을 특히 촘촘히 덮는다.

const lines = (src: string) => scanSource(src).map((h: { num: number }) => h.num);

describe("scanSource — 잡아야 하는 것", () => {
  it("JSX 텍스트", () => {
    expect(lines(`const a = <div>저장됨</div>;`)).toEqual([1]);
  });

  it("큰따옴표·작은따옴표·템플릿 리터럴 문자열", () => {
    expect(lines(`const a = "취소";`)).toEqual([1]);
    expect(lines(`const a = '취소';`)).toEqual([1]);
    expect(lines("const a = `취소`;")).toEqual([1]);
  });

  it("JSX 속성값 (aria-label / title / placeholder)", () => {
    expect(lines(`<button aria-label="닫기" />`)).toEqual([1]);
  });

  it("템플릿 리터럴의 ${} 안에 든 문자열", () => {
    expect(lines("const a = `${n}건 저장`;")).toEqual([1]);
  });

  it("여러 줄에서 각 위반 줄 번호를 정확히 보고한다", () => {
    const src = ['const a = 1;', 'const b = "취소";', 'const c = 2;', 'const d = "저장";'].join(
      "\n",
    );
    expect(lines(src)).toEqual([2, 4]);
  });
});

describe("scanSource — 건너뛰어야 하는 것", () => {
  it("줄 주석", () => {
    expect(lines(`const a = 1; // 한글 설명`)).toEqual([]);
  });

  it("블록 주석 (여러 줄)", () => {
    expect(lines(`/*\n * 한글 설명\n */\nconst a = 1;`)).toEqual([]);
  });

  it("JSDoc 주석", () => {
    expect(lines(`/** 한글 설명 */\nexport const a = 1;`)).toEqual([]);
  });
});

describe("scanSource — 상태 기계가 필요한 이유", () => {
  it("URL 안의 // 를 주석으로 오독하지 않는다", () => {
    // 라인 정규식이면 "https://" 뒤를 전부 주석으로 삼켜 이 한글을 놓친다.
    // 게이트가 조용히 뚫리는 정확한 경로 — 이 테스트가 그걸 막는다.
    const src = `const msg = "https://example.com 에서 확인하세요";`;
    expect(lines(src)).toEqual([1]);
  });

  it("문자열 안의 /* 도 주석 시작이 아니다", () => {
    expect(lines(`const glob = "src/*.ts 를 검사합니다";`)).toEqual([1]);
  });

  it("이스케이프된 따옴표가 문자열을 끝내지 않는다", () => {
    const src = `const a = "그는 \\"안녕\\" 이라 말했다";`;
    expect(lines(src)).toEqual([1]);
  });

  it("주석 뒤 같은 줄에 문자열이 이어지는 경우는 주석만 무시한다", () => {
    // 주석이 줄 끝까지라 뒤에 코드가 올 수 없다 — 다음 줄은 정상 검사돼야 한다.
    const src = `const a = 1; // 설명\nconst b = "취소";`;
    expect(lines(src)).toEqual([2]);
  });
});

describe("scanSource — 정규식 리터럴", () => {
  it("정규식 안의 따옴표가 문자열을 열지 않는다", () => {
    // 실제로 밟은 버그: `features/terminal/fileLinks.ts` 의 경로 정규식이
    // 문자 클래스에 `'` 와 `"` 를 담고 있어, 스캐너가 그 뒤 파일 전체를
    // "문자열 안"으로 오독했다. 주석 9줄이 통째로 위반으로 보고됐다.
    const src = [`const RE = /(?:^|[\\s'"(\\[<])(\\w+)/g;`, "// 한글 주석", "const a = 1;"].join(
      "\n",
    );
    expect(lines(src)).toEqual([]);
  });

  it("정규식 안의 // 를 줄 주석으로 오독하지 않는다", () => {
    // 반대 방향의 실패 — 이쪽은 게이트가 **조용히 뚫린다**. 같은 줄 뒤쪽
    // 한글이 주석으로 삼켜져 위반이 보고되지 않는다.
    const src = `const ok = /https:\\/\\//.test(u) ? "확인됨" : "";`;
    expect(lines(src)).toEqual([1]);
  });

  it("문자 클래스 안의 / 가 정규식을 끝내지 않는다", () => {
    const src = `const RE = /[a-z/]+/; const msg = "저장됨";`;
    expect(lines(src)).toEqual([1]);
  });

  it("정규식 문자 클래스의 한글은 **여전히** 보고된다", () => {
    // 면제는 스캐너가 조용히 봐주는 게 아니라 `i18n-ignore` 로 명시한다.
    expect(lines(`const RE = /[가-힣]/;`)).toEqual([1]);
  });

  it("JSX 닫는 태그를 정규식 시작으로 오인하지 않는다", () => {
    // `</` `/>` 를 정규식으로 보면 닫는 `/` 를 찾아 헤매다 뒤 코드를 삼킨다.
    const src = `const a = <div><br/></div>;\nconst b = "취소";`;
    expect(lines(src)).toEqual([2]);
  });

  it("나눗셈을 정규식 시작으로 오인하지 않는다", () => {
    const src = `const pct = done / total;\nconst msg = "완료";`;
    expect(lines(src)).toEqual([2]);
  });
});

describe("scanSource — i18n-ignore 예외", () => {
  it("같은 줄 i18n-ignore 로 면제된다", () => {
    expect(lines(`const RE = /[가-힣]/; // i18n-ignore -- 정규식 문자 클래스`)).toEqual([]);
  });

  it("앞줄 i18n-ignore-next-line 으로 면제된다", () => {
    const src = `// i18n-ignore-next-line -- 검색 별칭\nconst alias = "일지 기록";`;
    expect(lines(src)).toEqual([]);
  });

  it("면제는 해당 줄에만 적용된다 — 그 다음 줄은 다시 검사한다", () => {
    const src = [
      "// i18n-ignore-next-line -- 사유",
      'const a = "면제됨";',
      'const b = "면제 안 됨";',
    ].join("\n");
    expect(lines(src)).toEqual([3]);
  });
});

describe("scanSource — 깨끗한 소스", () => {
  it("t() 로 작성된 코드는 위반이 없다", () => {
    const src = [
      'import { useT } from "@/i18n";',
      "export function C() {",
      "  const { t } = useT();",
      '  return <div>{t("common.cancel")}</div>;',
      "}",
    ].join("\n");
    expect(lines(src)).toEqual([]);
  });
});
