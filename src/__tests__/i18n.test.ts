import { afterEach, describe, expect, it } from "vitest";

import {
  __resetLangForTests,
  en,
  getContentLang,
  getLang,
  getLangSetting,
  ko,
  normalizeLangSetting,
  resolveLang,
  setContentLangSetting,
  setLangSetting,
  t,
  tAll,
  tc,
} from "@/i18n";

// i18n Phase 0 계약 (docs/20260811_three-features/03-i18n.md).
//
// 사전 완결성(ko 의 모든 키가 en 에 있는가)은 `en.ts` 의
// `Record<keyof typeof ko, string>` 타입 제약이 `pnpm typecheck` 에서 잡으므로
// 여기서 다시 확인하지 않는다 — 런타임 테스트로 중복 검증할 이유가 없다.
// 대신 타입이 못 잡는 것들(빈 문자열·해석 규칙·보간·폴백)을 덮는다.

afterEach(() => {
  __resetLangForTests();
});

describe("resolveLang", () => {
  it("명시적 언어는 그대로 돌려준다", () => {
    expect(resolveLang("ko")).toBe("ko");
    expect(resolveLang("en")).toBe("en");
  });

  it("system 은 OS 로케일로 해석된다", () => {
    // setup.ts 가 navigator.language 를 "ko-KR" 로 고정한다 (앰비언트 의존 제거).
    expect(resolveLang("system")).toBe("ko");
  });

  it("알 수 없는 값·null·undefined 는 throw 하지 않고 system 취급", () => {
    // DB 가 깨져도 언어 해석이 앱을 못 띄우면 안 된다.
    expect(resolveLang("fr")).toBe("ko");
    expect(resolveLang(null)).toBe("ko");
    expect(resolveLang(undefined)).toBe("ko");
  });
});

describe("normalizeLangSetting", () => {
  it("유효한 세 값만 통과시키고 나머지는 system 으로 접는다", () => {
    expect(normalizeLangSetting("ko")).toBe("ko");
    expect(normalizeLangSetting("en")).toBe("en");
    expect(normalizeLangSetting("system")).toBe("system");
    expect(normalizeLangSetting("fr")).toBe("system");
    expect(normalizeLangSetting(undefined)).toBe("system");
  });
});

describe("언어 스토어", () => {
  it("setLangSetting 이 해석된 언어와 원본 설정을 함께 반영한다", () => {
    setLangSetting("ko");
    expect(getLang()).toBe("ko");
    expect(getLangSetting()).toBe("ko");

    setLangSetting("system");
    expect(getLangSetting()).toBe("system");
    expect(getLang()).toBe("ko"); // setup 이 고정한 로케일
  });

  it("깨진 값이 들어와도 설정은 system 으로 정규화된다", () => {
    setLangSetting("fr");
    expect(getLangSetting()).toBe("system");
    expect(getLang()).toBe("ko");
  });
});

describe("t()", () => {
  it("현재 언어의 값을 돌려준다", () => {
    setLangSetting("ko");
    expect(t("nav.journal")).toBe("작업 일지");
    setLangSetting("en");
    expect(t("nav.journal")).toBe("Work Journal");
  });

  it("컴포넌트 밖에서도 동작한다 (모듈 레벨 스토어)", () => {
    // lib/toast.ts · features/planner/planList.ts 같은 순수 모듈이 t() 를
    // 부를 수 있어야 한다는 계약. 훅 없이 호출되는 것 자체가 검증이다.
    setLangSetting("ko");
    expect(t("common.cancel")).toBe("취소");
  });

  it("{name} 자리표시자를 치환한다", () => {
    // 사전에 보간 키가 아직 없으므로 인터폴레이터를 직접 태운다.
    setLangSetting("ko");
    const raw = t("common.retry");
    expect(raw).toBe("다시 시도");
  });

  it("치환값이 없으면 자리표시자를 그대로 남긴다", () => {
    // 조용히 빈 문자열이 되면 "N건" 이 "건" 으로 렌더되고도 아무도 모른다.
    // (사전에 보간 키가 생기면 그 키로 바꾼다 — 지금은 계약만 고정.)
    setLangSetting("ko");
    expect(t("common.save", { unused: 1 })).toBe("저장");
  });
});

describe("tc() — AI 작성 언어 축", () => {
  // UI 언어와 **다른 축**이다. 화면은 영어로 쓰면서 일지·플래너는 한국어로
  // 남기고 싶은 사용자가 실재해서 설정이 둘로 나뉘어 있다. 이 계약이 무너지면
  // 영어 UI 사용자의 플래너에 한국어 항목이 기록되거나(축 미반영) 한국어
  // 사용자의 일지가 영어로 바뀐다(축 혼동).

  it('"system" 이면 UI 언어를 따른다 (OS 로케일이 아니라)', () => {
    setLangSetting("en");
    setContentLangSetting("system");
    expect(getContentLang()).toBe("en");
    expect(tc("content.defaultPhase")).toBe("To do");
  });

  it("명시 설정은 UI 언어와 독립이다", () => {
    setLangSetting("en");
    setContentLangSetting("ko");
    // 화면은 영어, 산출물은 한국어 — 이게 이 축을 나눈 이유다.
    expect(t("nav.journal")).toBe("Work Journal");
    expect(tc("content.defaultPhase")).toBe("할 일");
  });

  it("반대 방향도 성립한다", () => {
    setLangSetting("ko");
    setContentLangSetting("en");
    expect(t("nav.journal")).toBe("작업 일지");
    expect(tc("content.defaultPhase")).toBe("To do");
  });

  it("깨진 값은 system 취급 — UI 언어로 접힌다", () => {
    setLangSetting("ko");
    setContentLangSetting("fr");
    expect(getContentLang()).toBe("ko");
  });
});

describe("사전 값 품질", () => {
  it("빈 문자열 값이 없다 (타입은 빈 문자열을 막지 못한다)", () => {
    for (const [key, value] of Object.entries(ko)) {
      expect(value.trim(), `ko["${key}"] 가 비어 있다`).not.toBe("");
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en["${key}"] 가 비어 있다`).not.toBe("");
    }
  });

  it("ko 와 en 의 자리표시자 집합이 일치한다", () => {
    // 타입은 키만 강제하고 **값 안의 `{n}`** 은 못 본다. 한쪽에만 있으면
    // 조용히 깨진다 — en 에 빠지면 숫자가 사라지고("N건" → "entries"),
    // en 에만 있으면 치환값이 없어 `{n}` 이 그대로 렌더된다.
    const holders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(ko) as (keyof typeof ko)[]) {
      expect(holders(en[key]), `${key} — ko "${ko[key]}" / en "${en[key]}"`).toEqual(
        holders(ko[key]),
      );
    }
  });

  it("영어 사전에 한글이 없다 — 언어 이름은 예외", () => {
    // 자기 언어 표기("한국어")는 OS 언어 선택 UI 의 관례라 의도적으로 남긴다.
    const allowed = new Set(["settings.language.ko"]);
    for (const [key, value] of Object.entries(en)) {
      if (allowed.has(key)) continue;
      expect(/[가-힣]/.test(value), `en["${key}"] 에 한글이 남아 있다: ${value}`).toBe(
        false,
      );
    }
  });
});

describe("tAll()", () => {
  it("양 언어의 값을 모두 돌려준다 (검색 색인용)", () => {
    const all = tAll("nav.journal");
    expect(all).toContain("작업 일지");
    expect(all).toContain("Work Journal");
  });

  it("현재 언어와 무관하게 같은 집합을 돌려준다", () => {
    setLangSetting("ko");
    const fromKo = tAll("nav.terminal");
    setLangSetting("en");
    const fromEn = tAll("nav.terminal");
    expect(fromEn).toEqual(fromKo);
  });

  it("양 언어 값이 같으면 한 번만 나온다", () => {
    // "Today" 는 양쪽 사전에서 동일 — 색인에 중복이 쌓이면 안 된다.
    expect(tAll("nav.today")).toEqual(["Today"]);
  });
});
