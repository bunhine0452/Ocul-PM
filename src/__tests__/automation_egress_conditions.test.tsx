import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AutomationEditor } from "@/features/settings/automation/AutomationEditor";
import {
  AutomationHistory,
  CONDITION_NOTE_MARKERS,
  isConditionSkip,
} from "@/features/settings/automation/AutomationHistory";
import { EgressBadge } from "@/features/settings/automation/EgressBadge";
import {
  CONDITIONS,
  blankDefinition,
  describeConditions,
  egressNotice,
  newCondition,
  providerLabel,
  takesThreshold,
} from "@/features/settings/automation/automationModel";
import type { AutomationDef, AutomationRunDto, ModelEgress } from "@/lib/bindings";

// 유출 배지 ({#automation-egress-badge}) + 실행 조건 ({#automation-step-if}).
//
// 이 파일이 지키는 계약:
//
//  1. **로컬 모델에는 배지가 붙지 않는다.** 붙고 안 붙고의 차이가 제품의 1번
//     약속 그 자체다 — "로컬 우선" 은 로컬일 때 화면이 조용해야 참이 된다.
//  2. 원격이면 **프로바이더 이름과 호스트가 실제로 찍힌다.** "외부로 나감"
//     같은 뭉뚱그린 문구는 사용자가 확인할 수 없어 안심도 경계도 주지 못한다.
//  3. 조건 편집은 **열거된 어휘**뿐이다 — 자유 표현식 입력칸이 없다.
//  4. 조건 미충족으로 건너뛴 실행이 이력에서 **성공처럼 보이지 않는다.**

const LOCAL: ModelEgress = {
  provider: "ollama",
  model: "qwen2.5-coder",
  host: "127.0.0.1:11434",
  local: true,
};
const REMOTE: ModelEgress = {
  provider: "anthropic",
  model: "claude-3.5-haiku-latest",
  host: "api.anthropic.com",
  local: false,
};

function editorProps(def: AutomationDef, egress: ModelEgress | null) {
  return {
    value: def,
    isNew: true,
    busy: false,
    egress,
    onCancel: () => {},
    onSave: () => {},
  };
}

function run(over: Partial<AutomationRunDto>): AutomationRunDto {
  return {
    id: "1",
    automation_id: "weekly-dev-summary",
    session_id: "sched-20260905-170000",
    started_at: "2026-09-05T08:00:00+00:00",
    ended_at: "2026-09-05T08:00:01+00:00",
    status: "ok",
    journal_path: null,
    note: null,
    ...over,
  };
}

afterEach(cleanup);

describe("유출 배지 — 로컬이면 붙지 않는다", () => {
  it("로컬 모델 자동화에는 배지가 없다", () => {
    const notice = egressNotice(LOCAL);
    // 로컬도 문장은 만든다(안심을 주는 쪽) — 다만 경고 배지가 아니다.
    expect(notice?.hint).toBeNull();

    render(<EgressBadge notice={notice} />);
    const badge = screen.getByTestId("automation-egress-badge");
    expect(badge.getAttribute("data-egress")).toBe("local");
    // 「보냅니다」라는 말이 로컬 화면에 뜨면 그게 거짓말이다.
    expect(badge.textContent).not.toContain("보냅니다");
    expect(badge.textContent).toContain("나가지 않습니다");
  });

  it("에디터에서도 로컬 모델이면 유출 경고가 뜨지 않는다", () => {
    const def = { ...blankDefinition("2026-09-05"), title: "t", instructions: "i", id: "t" };
    render(<AutomationEditor {...editorProps(def, LOCAL)} />);
    const badge = screen.getByTestId("automation-egress-badge");
    expect(badge.getAttribute("data-egress")).toBe("local");
    expect(badge.textContent).not.toContain("api.anthropic.com");
  });

  it("배경 모델이 없으면 배지 자체가 없다 (게이트 안내가 따로 말한다)", () => {
    expect(egressNotice(null)).toBeNull();
    expect(egressNotice(undefined)).toBeNull();
    const { container } = render(<EgressBadge notice={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("유출 배지 — 원격이면 이름과 호스트를 찍는다", () => {
  it("프로바이더 이름이 실제로 배지에 나온다", () => {
    const def = { ...blankDefinition("2026-09-05"), title: "t", instructions: "i", id: "t" };
    render(<AutomationEditor {...editorProps(def, REMOTE)} />);
    const badge = screen.getByTestId("automation-egress-badge");
    expect(badge.getAttribute("data-egress")).toBe("remote");
    expect(badge.textContent).toContain("Anthropic");
    expect(badge.textContent).toContain("api.anthropic.com");
    // 뭉뚱그린 문구 금지 — 어디로 가는지 이름이 없으면 배지가 아니라 장식이다.
    expect(badge.textContent).not.toMatch(/^외부로 나감$/);
  });

  it("모르는 프로바이더는 아는 척하지 않고 id 를 그대로 보여 준다", () => {
    expect(providerLabel("anthropic")).toBe("Anthropic");
    expect(providerLabel("openrouter")).toBe("OpenRouter");
    expect(providerLabel("brand-new-thing")).toBe("brand-new-thing");
  });
});

describe("실행 조건 — 열거된 어휘만", () => {
  it("고를 수 있는 조건은 세 가지이고 unknown 은 목록에 없다", () => {
    expect([...CONDITIONS]).toEqual([
      "journal_count_gte",
      "plan_has_open_items",
      "git_dirty",
    ]);
    expect(CONDITIONS as readonly string[]).not.toContain("unknown");
  });

  it("임계값은 journal_count_gte 만 쓴다 — 나머지 정의에 n 이 붙지 않는다", () => {
    expect(takesThreshold("journal_count_gte")).toBe(true);
    expect(takesThreshold("git_dirty")).toBe(false);
    expect(newCondition("journal_count_gte").n).toBe(3);
    expect(newCondition("plan_has_open_items").n).toBeNull();
  });

  it("새 자동화의 기본은 조건 없음 = 항상 실행", () => {
    const def = blankDefinition("2026-09-05");
    expect(def.conditions).toEqual([]);
    expect(describeConditions(def)).toBeNull();
  });

  it("에디터가 자유 표현식 입력칸을 만들지 않는다", () => {
    const def: AutomationDef = {
      ...blankDefinition("2026-09-05"),
      title: "t",
      instructions: "i",
      id: "t",
      conditions: [newCondition("journal_count_gte")],
    };
    render(<AutomationEditor {...editorProps(def, REMOTE)} />);
    // 조건 선택은 <select> 이고, 그 옵션은 열거된 셋뿐이다.
    const select = screen.getByLabelText("실행 조건") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([...CONDITIONS]);
    // 임계값 칸은 number 라 식이 들어갈 수 없다.
    const n = screen.getByLabelText("새 일지가 N건 이상") as HTMLInputElement;
    expect(n.type).toBe("number");
  });

  it("읽지 못한 조건은 감추지 않고 원문과 함께 보여 준다", () => {
    const def: AutomationDef = {
      ...blankDefinition("2026-09-05"),
      title: "t",
      instructions: "i",
      id: "t",
      conditions: [{ when: "unknown", n: null, raw: "jornal_count_gte" }],
    };
    render(<AutomationEditor {...editorProps(def, REMOTE)} />);
    const select = screen.getByLabelText("실행 조건") as HTMLSelectElement;
    expect(select.value).toBe("unknown");
    expect(select.textContent).toContain("jornal_count_gte");
  });

  it("카드 요약이 조건을 임계값까지 말한다", () => {
    const def: AutomationDef = {
      ...blankDefinition("2026-09-05"),
      conditions: [newCondition("journal_count_gte"), newCondition("git_dirty")],
    };
    const line = describeConditions(def);
    expect(line).toContain("(3)");
    expect(line).toContain("git");
  });
});

describe("실행 이력 — 조건 미충족은 성공이 아니다", () => {
  it("건너뛴 실행이 사유와 함께 「조건 미충족」으로 보인다", () => {
    render(
      <AutomationHistory
        loading={false}
        runs={[
          run({
            status: "skipped",
            note: "조건 미충족 — 직전 실행 이후 새 일지 0건 (필요: 3건 이상)",
          }),
        ]}
      />
    );
    expect(screen.getByText("조건 미충족")).toBeTruthy();
    // 관측값과 필요값이 그대로 읽혀야 고칠 수 있다.
    expect(screen.getByText(/새 일지 0건/)).toBeTruthy();
    expect(screen.getByText(/3건 이상/)).toBeTruthy();
    expect(screen.queryByText("성공")).toBeNull();
  });

  it("러너가 사연을 앞에 붙여도(수동 실행 등) 같은 칩이 뜬다", () => {
    expect(
      isConditionSkip({ status: "skipped", note: "manual run · 조건 미충족 — …" })
    ).toBe(true);
    expect(
      isConditionSkip({ status: "skipped", note: "조건을 읽지 못했다 — 'x' 는 …" })
    ).toBe(true);
    // 다른 스킵(예산·모델 미설정)은 원래 문구를 지킨다.
    expect(
      isConditionSkip({ status: "skipped", note: "배경 작업 모델이 설정되지 않았다" })
    ).toBe(false);
    expect(isConditionSkip({ status: "ok", note: "조건 미충족" })).toBe(false);
  });

  it("사유 대조 패턴이 백엔드 문구와 같다 (크로스-언어 계약)", () => {
    // 이 배열이 `conditions::first_unmet` 의 머리말과 갈라지면 칩이 무증상으로
    // 「건너뜀」으로 되돌아간다. Rust 쪽에도 같은 문구를 무는 테스트가 있다.
    expect([...CONDITION_NOTE_MARKERS]).toEqual(["조건 미충족", "조건을 읽지 못했다"]);
  });
});
