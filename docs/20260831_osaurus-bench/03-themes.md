# 03 — 테마 파일화 · 프로젝트 바인딩

> Phase 4 · 상위: [00-master-plan.md](00-master-plan.md)

## 0. 현재 상태

프리셋 5종(`solarized` `sepia` `nord` `dracula` `high-contrast`)이
`src/styles/tokens.css` 에 **하드코딩**돼 있습니다. `[data-preset="…"]` 블록이
`--bg-window` · `--text-2` · `--accent-soft` 등을 재정의하고,
`SettingsContext.PRESET_FAMILY` 가 각 프리셋의 light/dark 기반 가족을 말합니다.

사용자가 색을 만들 수 없고, 주고받을 수 없고, 프로젝트마다 다르게 둘 수 없습니다.

Osaurus 는 테마가 **JSON 파일**이고 우클릭 Export / Import 로 오갑니다. 그리고
**에이전트에 `themeId` 를 바인딩**해 그 에이전트가 활성화되면 테마가 바뀝니다 —
*"코드 리뷰어와 얘기 중인지 테라피스트와 얘기 중인지 시각으로 안다."*

## 1. 스키마 v1 (D3)

Osaurus 처럼 별도 이름 체계(`colors.primaryText`)를 만들지 않고 **CSS 변수 이름을
그대로** 씁니다. `tokens.css` 가 이미 단일 SSOT 이므로 매핑 표를 만들면 그것이
영원한 부채가 됩니다.

`.oculpm` 밖, 앱 데이터에 둡니다 (`app_data_dir()/themes/<uuid>.json`) — 테마는
프로젝트가 아니라 사람에게 속합니다.

```json
{
  "oculpm_theme": "v1",
  "metadata": {
    "id": "9f2c…",
    "name": "미드나이트 코랄",
    "version": "1.0",
    "author": "Kim Hyunbin",
    "created_at": "2026-08-31T17:00:00+09:00",
    "updated_at": "2026-08-31T17:00:00+09:00"
  },
  "family": "dark",
  "is_built_in": false,
  "follows_system_accent": false,
  "tokens": {
    "--bg-window": "#141416",
    "--bg-sidebar": "#0f0f10",
    "--text": "#f4f4f5",
    "--accent": "#ff7a66",
    "--accent-soft": "rgba(255,122,102,0.16)"
  }
}
```

**규칙**
- `family` 는 `light | dark` — 기존 `data-theme` 가족을 그대로 태웁니다. 코드
  에디터·hljs·스크롤바·글래스가 전부 이 축을 보므로 반드시 있어야 합니다.
- `tokens` 는 **부분 지정 가능**합니다. 빠진 토큰은 가족 기본값을 상속합니다 —
  "강조색만 바꾼 테마" 가 5줄로 성립합니다.
- 값은 CSS 색 문자열 그대로 (hex · `rgba()`). 파서를 만들지 않습니다.
- 허용 토큰은 **화이트리스트**입니다. `tokens.css` 에서 추출한 목록 밖의 키는
  임포트 시 거부하고 사유를 보고합니다 (임의 CSS 주입 차단).
- `follows_system_accent: true` 면 강조 계열(`--accent` `--accent-strong`
  `--accent-text` `--accent-soft` `--accent-ring`)을 macOS 시스템 강조색에서
  재유도합니다.

**내장 5종을 같은 스키마로 표현**합니다 — `tokens.css` 의 `[data-preset]` 블록에서
빌드 타임에 JSON 을 생성하고, 테스트가 "생성된 JSON 과 CSS 블록이 일치" 를 단언합니다
(`src/__tests__/design_tokens.test.ts` 옆). 내장이 곧 예제가 됩니다.

## 2. 적용 방식

지금 `SettingsContext` 는 `data-theme` / `data-preset` / `data-accent` 속성만 답니다.
커스텀 테마는 여기에 **인라인 CSS 변수**를 얹습니다.

```
<html data-theme="dark" data-preset="custom" style="--bg-window:#141416; --accent:#ff7a66; …">
```

- `data-preset="custom"` 은 내장 프리셋 규칙과 충돌하지 않게 하는 표식일 뿐입니다.
- 인라인 변수는 명시도 최상위라 어떤 블록도 이깁니다 — 부분 지정 상속이
  자연스럽게 성립합니다.
- 창이 여럿이므로 `settingsChanged` 이벤트로 전 창이 같이 바뀝니다 (기존 규약).

**`data-accent` 와의 관계**: 지금 프리셋이 활성이면 `SettingsContext` 가
`data-accent` 를 **제거**합니다(프리셋이 자기 강조색을 갖기 때문). 커스텀 테마가
강조 토큰을 지정하지 않으면 사용자가 고른 강조색까지 사라집니다.

규칙: 커스텀 테마가 **강조 5토큰(`--accent` `--accent-strong` `--accent-text`
`--accent-soft` `--accent-ring`)을 하나도 지정하지 않으면 `data-accent` 를 유지**
합니다. 하나라도 지정하면 테마가 강조를 소유한 것으로 보고 제거합니다.
`follows_system_accent` 는 후자의 특수한 경우입니다 (테마가 소유하되 값을
시스템에서 유도).

## 3. Import / Export

| 동작 | 규칙 |
|---|---|
| Export | 테마 카드 우클릭 → `.json` 저장. `is_built_in` 은 항상 `false` 로 기록 |
| Import | 파일 선택 → **`metadata.id` 무시하고 새 UUID 발급** · `is_built_in` 강제 `false` |
| 검증 | 토큰 화이트리스트 · 파일 크기 상한(256KB) · 알 수 없는 최상위 키는 무시 |
| 충돌 | 같은 이름이 있으면 "덮어쓰기 / 사본으로" 를 묻습니다 (조용한 덮어쓰기 금지) |

Osaurus 가 `metadata.id` 를 버리는 이유가 정확합니다 — 남의 테마 id 가 내
내장 테마와 충돌하는 사고를 구조적으로 없앱니다.

## 4. 에디터

설정 → 모양(`AppearanceTab`) 안에 테마 갤러리 + 편집 패널.

- 내장 5종은 **읽기 전용**, "복제해서 편집" 만 제공
- 편집은 **라이브 프리뷰** — 입력 즉시 인라인 변수를 갱신해 앱 전체가 바뀝니다
  (별도 미리보기 캔버스를 만들지 않습니다. 앱이 곧 미리보기입니다)
- 섹션: 배경 / 글자 / 강조 / 경계·구분 / 상태색. polish-round 가 만든 토큰
  그룹을 그대로 씁니다
- "가족 기본값으로 되돌리기" 를 토큰마다 (부분 지정을 되돌릴 유일한 방법)

## 5. 프로젝트별 테마 (핵심)

Osaurus 의 "에이전트에 테마 바인딩" 을 ocul-pm 에서는 **프로젝트 바인딩**으로
번역합니다. 여러 저장소를 동시에 열어 두고 어디 있는지 헷갈리는 문제를 색으로
해결합니다.

`027_project_appearance.sql` 은 별도 테이블이 아니라 `projects` 에 붙인 두 컬럼입니다
(`ALTER TABLE projects ADD COLUMN icon TEXT; … color TEXT;`). 같은 방식으로 한 컬럼을
더합니다 — `034_project_theme.sql`: `ALTER TABLE projects ADD COLUMN theme_id TEXT;`

027 의 주석이 정확히 우리가 지킬 규칙을 적어 두었습니다: *"값은 hex 색이 아니라
**id 문자열**을 저장한다… 라이트/다크/프리셋 5종에서 같은 hex 가 성립하지 않는다."*
`theme_id` 도 같습니다 — 색이 아니라 테마 id 를 저장합니다.

**규칙**
- 프로젝트에 테마가 바인딩돼 있으면 그 프로젝트 창에서 그 테마가 적용됩니다.
- 바인딩이 없으면 전역 설정 테마로 되돌아갑니다 (Osaurus 와 동일).
- 창 단위로 적용됩니다 — 창마다 다른 프로젝트면 창마다 다른 색입니다.
  (멀티 창 모델: 메인 = 런처, 프로젝트는 별도 창.)
- 사이드바 프로젝트 스위처와 프로젝트 색(`--pc`)은 그대로 둡니다 — 테마는
  전체 표면, 프로젝트 색은 마크. 두 축은 겹치지 않습니다.

## 6. 테스트

| 대상 | 방식 |
|---|---|
| 스키마 왕복 | JSON → 인라인 스타일 → JSON, 손실 0 |
| 내장 일치 | 생성된 내장 JSON 5종 == `tokens.css` `[data-preset]` 블록 |
| 화이트리스트 | 허용 밖 키(`--evil`)·CSS 주입 문자열 → 거부 + 사유 |
| 부분 지정 | 3토큰 테마 → 나머지는 가족 기본값 |
| 임포트 id | 같은 `metadata.id` 를 두 번 임포트 → 서로 다른 두 테마 |
| 프로젝트 바인딩 | 창 A(바인딩) · 창 B(무바인딩) → 각자 다른 테마 유지 |
| 대비 | `high-contrast` 를 기준으로 a11y 대비비 회귀 테스트 유지 |
