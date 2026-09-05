//! 스텝 실행 조건 — 자유 표현식이 아니라 **닫힌 어휘** ({#automation-step-if}).
//!
//! # 왜 필요한가
//!
//! 「일지가 3건 이상일 때만 주간 요약」이 지금까지는 지시문 본문의 *부탁*이었다
//! (씨앗 정의의 "이미 요약한 주는 건너뛰세요"). 모델은 그 부탁을 지킬 수도
//! 있고 안 지킬 수도 있으며, 실제로는 **빈 요약을 만들고 성공했다고 말했다** —
//! 원장에는 `ok` 가 남고 일지가 한 건 늘어난다. 프롬프트에 의존한 게이트는
//! 게이트가 아니다.
//!
//! # 왜 eval 이 아닌가
//!
//! 조건식을 문자열로 받아 평가하면 (a) 정의 파일이 실행 가능한 코드가 되고
//! (b) 파서와 샌드박스를 우리가 떠안는다. 정의 파일은 git 에 올라가고 사람이
//! 손으로 고친다 — 거기에 실행기를 두지 않는다. 그래서 어휘는 닫혀 있다
//! ([`ConditionWhen::ALL`]). 여기 없는 이름은 **읽지 못한 조건**이고, 읽지
//! 못한 조건은 통과시키지 않는다 (fail-closed — 모르는 게이트를 열어 두면
//! 게이트가 아니다).
//!
//! # 창(window)
//!
//! [`ConditionWhen::JournalCountGte`] 가 세는 것은 「**직전 성공 실행 이후**
//! 새로 들어온 일지」다. 한 번도 성공한 적이 없으면 전체 기간이다 — 첫 실행은
//! 돌아야 한다. 창을 여는 쪽은 러너이고([`super::runner`]), 이 모듈은 그가
//! 세어 온 숫자만 본다.
//!
//! # 순수
//!
//! 판정은 [`first_unmet`] 하나이고 입력은 [`ConditionFacts`] 다. DB·git 는
//! 러너가 읽어서 넘긴다 — 네트워크도 디스크도 없이 단언할 수 있어야 회귀가
//! 잡힌다.

use serde::{Deserialize, Serialize};
use specta::Type;

/// 조건의 종류. **이 목록이 전부다** — 새 조건은 여기에 변형을 더하는 것이지
/// 문자열로 표현하는 것이 아니다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ConditionWhen {
    /// 직전 성공 실행 이후 새 일지가 `n` 건 이상.
    JournalCountGte,
    /// 활성 플랜에 미완 항목(todo/in_progress/blocked)이 하나라도 있다.
    PlanHasOpenItems,
    /// git 워킹트리에 커밋되지 않은 변경이 있다.
    GitDirty,
    /// 읽지 못한 조건. 정의 파일에만 나타나고 UI 는 만들지 않는다 —
    /// **항상 불충족**이다.
    Unknown,
}

impl ConditionWhen {
    /// 사람이 고를 수 있는 조건 전부. `Unknown` 은 여기 없다.
    pub const ALL: [ConditionWhen; 3] = [
        ConditionWhen::JournalCountGte,
        ConditionWhen::PlanHasOpenItems,
        ConditionWhen::GitDirty,
    ];

    /// 정의 파일의 `when:` 값.
    pub fn as_str(self) -> &'static str {
        match self {
            ConditionWhen::JournalCountGte => "journal_count_gte",
            ConditionWhen::PlanHasOpenItems => "plan_has_open_items",
            ConditionWhen::GitDirty => "git_dirty",
            ConditionWhen::Unknown => "unknown",
        }
    }

    /// 아는 이름만 통과한다. `unknown` 이라는 글자도 통과시키지 않는다 —
    /// 그건 어휘가 아니라 판정 결과다.
    pub fn parse(raw: &str) -> Option<Self> {
        ConditionWhen::ALL
            .into_iter()
            .find(|w| w.as_str() == raw.trim())
    }

    /// 임계값(`n`)을 읽는 조건인가. 에디터가 숫자 입력칸을 이걸 보고 켠다.
    pub fn takes_threshold(self) -> bool {
        matches!(self, ConditionWhen::JournalCountGte)
    }
}

/// 조건 하나.
///
/// `raw` 는 [`ConditionWhen::Unknown`] 일 때만 채워지고, 원문을 **잃지 않기
/// 위해** 있다: 정의 파일은 사람이 손으로 고치는 SSOT 라, 오타 하나를 저장
/// 한 번으로 지워 버리면 무엇을 쓰려 했는지가 사라진다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AutomationCondition {
    pub when: ConditionWhen,
    /// 임계값. `journal_count_gte` 만 읽는다. 없으면 1로 본다.
    pub n: Option<u32>,
    /// `when` 을 읽지 못했을 때의 원문.
    pub raw: Option<String>,
}

impl AutomationCondition {
    pub fn new(when: ConditionWhen, n: Option<u32>) -> Self {
        Self {
            when,
            n: when.takes_threshold().then(|| n.unwrap_or(1)),
            raw: None,
        }
    }

    /// 읽지 못한 조건. 원문을 그대로 들고 다닌다.
    pub fn unknown(raw: impl Into<String>) -> Self {
        Self {
            when: ConditionWhen::Unknown,
            n: None,
            raw: Some(raw.into()),
        }
    }

    /// 임계값 — 없거나 0이면 1. 0을 허용하면 「0건 이상」이 되어 조건이 아니라
    /// 장식이 된다.
    pub fn threshold(&self) -> u32 {
        self.n.unwrap_or(1).max(1)
    }
}

/// 판정에 쓰이는 관측 사실. **입력이지 조회기가 아니다** — 여기서 DB 도 git 도
/// 읽지 않는다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ConditionFacts {
    /// 직전 성공 실행 이후 새로 들어온 일지 수.
    pub new_journal_entries: u32,
    /// 활성 플랜의 미완 항목 수.
    pub open_plan_items: u32,
    /// git 워킹트리에 커밋되지 않은 변경이 있는가.
    pub git_dirty: bool,
}

/// 어떤 사실을 실제로 읽어야 하는가. 조건이 묻지 않은 것은 세지 않는다 —
/// `git_dirty` 하나가 하위 프로세스를, `journal_count_gte` 하나가 질의 두 번을
/// 부른다. 조건 없는 자동화(대다수)는 아무것도 더 내지 않는다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FactNeeds {
    pub journal: bool,
    pub plan: bool,
    pub git: bool,
}

impl FactNeeds {
    pub fn any(self) -> bool {
        self.journal || self.plan || self.git
    }
}

/// 이 조건 묶음이 필요로 하는 사실.
pub fn needs(conditions: &[AutomationCondition]) -> FactNeeds {
    let mut out = FactNeeds::default();
    for c in conditions {
        match c.when {
            ConditionWhen::JournalCountGte => out.journal = true,
            ConditionWhen::PlanHasOpenItems => out.plan = true,
            ConditionWhen::GitDirty => out.git = true,
            // 읽지 못한 조건은 사실을 묻지 않는다 — 무조건 막힌다.
            ConditionWhen::Unknown => {}
        }
    }
    out
}

/// 첫 번째로 불충족인 조건의 **원장에 적을 한 줄**. `None` = 전부 통과
/// (조건이 없으면 언제나 통과 — 기본값은 「조건 없음 = 항상 실행」이다).
///
/// 사유가 관측값을 함께 싣는 것이 핵심이다: History 에서 「건너뜀」만 보이면
/// 왜 안 돌았는지를 다시 추측하게 되고, 그게 이 라운드가 없애려는 상태다.
pub fn first_unmet(conditions: &[AutomationCondition], facts: &ConditionFacts) -> Option<String> {
    conditions.iter().find_map(|c| match c.when {
        ConditionWhen::JournalCountGte => {
            let need = c.threshold();
            (facts.new_journal_entries < need).then(|| {
                format!(
                    "조건 미충족 — 직전 실행 이후 새 일지 {}건 (필요: {need}건 이상)",
                    facts.new_journal_entries
                )
            })
        }
        ConditionWhen::PlanHasOpenItems => (facts.open_plan_items == 0)
            .then(|| "조건 미충족 — 활성 플랜에 미완 항목이 없다".into()),
        ConditionWhen::GitDirty => (!facts.git_dirty)
            .then(|| "조건 미충족 — git 워킹트리에 커밋되지 않은 변경이 없다".into()),
        ConditionWhen::Unknown => Some(format!(
            "조건을 읽지 못했다 — '{}' 는 아는 조건이 아니다 (막는다)",
            c.raw.as_deref().unwrap_or("?")
        )),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// 정의 파일의 wire form
// ─────────────────────────────────────────────────────────────────────────────
//
// 닫힌 어휘가 **자기 표기법을 소유한다** — 읽는 규칙과 쓰는 규칙이 갈라지면
// 왕복이 조용히 깨지고, 그 다음 저장 한 번이 사용자의 조건을 지운다.
// (`store` 의 frontmatter 파서가 이 둘을 부른다.)

use super::store::{yaml_str, yaml_u32};
use serde_yaml::Value as YamlValue;

/// `conditions:` 를 읽는다 ({#automation-step-if}).
///
/// 두 모양을 다 받는다 — 손으로 고치는 파일이라 짧은 쪽을 쓰고 싶어진다:
///
/// ```yaml
/// conditions:
///   - when: journal_count_gte
///     n: 3
///   - git_dirty          # 임계값이 없는 조건은 이 축약형도 된다
/// ```
///
/// **읽지 못한 항목은 버리지 않고 `Unknown` 으로 남긴다.** 버리면 오타 하나가
/// 게이트를 열어 버린다 — 조건이 있다고 믿는데 없는 상태가 없는 것보다 나쁘다.
pub fn parse_conditions(
    map: &serde_yaml::Mapping,
    warnings: &mut Vec<String>,
) -> Vec<AutomationCondition> {
    let Some(value) = map.get(YamlValue::String("conditions".to_string())) else {
        return Vec::new();
    };
    let Some(seq) = value.as_sequence() else {
        warnings.push("conditions 는 목록이어야 한다 — 조건 없음으로 읽는다".into());
        return Vec::new();
    };

    let mut out = Vec::new();
    for item in seq {
        let (raw_when, n) = match item {
            // 축약형: `- git_dirty`
            YamlValue::String(s) => (s.trim().to_string(), None),
            YamlValue::Mapping(m) => {
                let Some(w) = yaml_str(m, "when") else {
                    warnings.push("조건 항목에 when 이 없다 — 막는다".into());
                    out.push(AutomationCondition::unknown("(when 없음)"));
                    continue;
                };
                (w, yaml_u32(m, "n"))
            }
            other => {
                let shape = serde_yaml::to_string(other).unwrap_or_else(|_| "?".into());
                warnings.push(format!(
                    "조건 항목을 읽지 못했다: {} — 막는다",
                    shape.trim()
                ));
                out.push(AutomationCondition::unknown(shape.trim()));
                continue;
            }
        };
        match ConditionWhen::parse(&raw_when) {
            Some(when) => out.push(AutomationCondition::new(when, n)),
            None => {
                warnings.push(format!(
                    "'{raw_when}' 는 아는 조건이 아니다 — 이 자동화는 돌지 않는다"
                ));
                out.push(AutomationCondition::unknown(raw_when));
            }
        }
    }
    out
}

/// 조건을 frontmatter 로. **비었으면 키 자체를 쓰지 않는다** — 조건을 쓰지 않는
/// 정의의 파일이 이 라운드 때문에 바뀌면 멱등 쓰기 계약이 깨지고, git 에 아무
/// 의미 없는 diff 가 한 줄씩 생긴다.
pub fn render_conditions(fm: &mut String, conditions: &[AutomationCondition]) {
    if conditions.is_empty() {
        return;
    }
    fm.push_str("conditions:\n");
    for c in conditions {
        // `Unknown` 은 원문을 그대로 되쓴다 (사람이 고칠 수 있게). 따옴표로
        // 감싸 콜론·`#` 이 든 오타가 YAML 을 깨뜨리지 않게 한다.
        match c.when {
            ConditionWhen::Unknown => {
                let raw = c.raw.as_deref().unwrap_or("unknown");
                let escaped = raw.replace('\\', "\\\\").replace('"', "\\\"");
                fm.push_str(&format!("  - when: \"{escaped}\"\n"));
            }
            when => {
                fm.push_str(&format!("  - when: {}\n", when.as_str()));
                if let Some(n) = c.n {
                    fm.push_str(&format!("    n: {n}\n"));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(journal: u32, plan: u32, dirty: bool) -> ConditionFacts {
        ConditionFacts {
            new_journal_entries: journal,
            open_plan_items: plan,
            git_dirty: dirty,
        }
    }

    /// 기본값은 「조건 없음 = 항상 실행」이다. 이게 깨지면 기존 정의가 전부
    /// 멈춘다 (스키마 하위호환의 심장).
    #[test]
    fn no_conditions_always_runs() {
        assert_eq!(first_unmet(&[], &facts(0, 0, false)), None);
        assert!(!needs(&[]).any());
    }

    #[test]
    fn journal_threshold_is_a_gate_not_a_suggestion() {
        let c = [AutomationCondition::new(
            ConditionWhen::JournalCountGte,
            Some(3),
        )];
        // 이것이 원래 버그다 — 새 일지 0건인데 요약을 만들고 성공이라 말했다.
        let unmet = first_unmet(&c, &facts(0, 0, false)).expect("0건이면 막혀야 한다");
        assert!(unmet.contains("0건"), "{unmet}");
        assert!(unmet.contains("3건 이상"), "{unmet}");

        assert!(first_unmet(&c, &facts(2, 0, false)).is_some());
        assert_eq!(first_unmet(&c, &facts(3, 0, false)), None, "경계는 포함");
        assert_eq!(first_unmet(&c, &facts(9, 0, false)), None);
    }

    /// `n` 이 없거나 0이면 1로 본다 — 「0건 이상」은 조건이 아니라 장식이다.
    #[test]
    fn a_missing_or_zero_threshold_means_at_least_one() {
        let mut c = AutomationCondition::new(ConditionWhen::JournalCountGte, None);
        assert_eq!(c.threshold(), 1);
        c.n = Some(0);
        assert_eq!(c.threshold(), 1);
        assert!(first_unmet(std::slice::from_ref(&c), &facts(0, 0, false)).is_some());
        assert_eq!(first_unmet(&[c], &facts(1, 0, false)), None);
    }

    #[test]
    fn plan_and_git_conditions_read_their_own_fact() {
        let plan = [AutomationCondition::new(
            ConditionWhen::PlanHasOpenItems,
            None,
        )];
        assert!(first_unmet(&plan, &facts(0, 0, false)).is_some());
        assert_eq!(first_unmet(&plan, &facts(0, 1, false)), None);
        // 임계값을 쓰지 않는 조건에는 `n` 이 붙지 않는다 (정의 파일이 거짓말을
        // 하지 않게).
        assert_eq!(plan[0].n, None);

        let git = [AutomationCondition::new(ConditionWhen::GitDirty, None)];
        assert!(first_unmet(&git, &facts(0, 0, false)).is_some());
        assert_eq!(first_unmet(&git, &facts(0, 0, true)), None);
    }

    /// 읽지 못한 조건은 **막는다**. 통과시키면 오타 하나가 게이트를 여는 셈이
    /// 되고, 그건 게이트가 없는 것보다 나쁘다 (있다고 믿게 되니까).
    #[test]
    fn an_unreadable_condition_fails_closed_and_keeps_its_text() {
        let c = [AutomationCondition::unknown("jornal_count_gte")];
        let unmet = first_unmet(&c, &facts(999, 999, true)).expect("모르는 조건은 통과 못 한다");
        assert!(unmet.contains("jornal_count_gte"), "{unmet}");
        // 사실을 묻지도 않는다 — 어차피 막힌다.
        assert!(!needs(&c).any());
    }

    /// 첫 번째 불충족에서 멈춘다 — 사유가 하나여야 History 한 줄이 읽힌다.
    #[test]
    fn the_first_unmet_condition_wins() {
        let c = [
            AutomationCondition::new(ConditionWhen::PlanHasOpenItems, None),
            AutomationCondition::new(ConditionWhen::GitDirty, None),
        ];
        let unmet = first_unmet(&c, &facts(0, 0, false)).unwrap();
        assert!(unmet.contains("플랜"), "{unmet}");
    }

    /// 묻지 않은 사실은 읽지 않는다 (git 하위 프로세스 비용).
    #[test]
    fn needs_asks_only_for_what_the_conditions_use() {
        let n = needs(&[AutomationCondition::new(
            ConditionWhen::JournalCountGte,
            Some(2),
        )]);
        assert_eq!(
            n,
            FactNeeds {
                journal: true,
                plan: false,
                git: false
            }
        );
        let all = needs(&ConditionWhen::ALL.map(|w| AutomationCondition::new(w, None)));
        assert_eq!(
            all,
            FactNeeds {
                journal: true,
                plan: true,
                git: true
            }
        );
    }

    /// 어휘는 닫혀 있다 — `parse` 는 `ALL` 만 통과시킨다.
    #[test]
    fn the_vocabulary_is_closed() {
        for w in ConditionWhen::ALL {
            assert_eq!(ConditionWhen::parse(w.as_str()), Some(w));
        }
        assert_eq!(ConditionWhen::parse("unknown"), None);
        assert_eq!(ConditionWhen::parse("journal_count > 3"), None);
        assert_eq!(ConditionWhen::parse(""), None);
    }
}
