# Notion Public Integration (OAuth) 등록 체크리스트 — 2026-07 공식 문서 기준

**중요 선행 사실**: Notion 은 2026-05-13 "Developer Platform 3.5" 릴리스에서 전용 **Developer portal (app.notion.com/developers)** 을 도입했고, 공식 문서 용어가 "integration" → **"connection"** 으로 바뀌었습니다. 과거의 `notion.so/my-integrations` + "Distribution" 탭 토글 방식은 현재 공식 문서(developers.notion.com)에서 더 이상 안내되지 않습니다. ([릴리스 노트](https://www.notion.com/releases/2026-05-13))

## 1. Public connection 만들기 (만들기 경로·필드명)

- [ ] **Developer portal 접속**: `https://app.notion.com/developers/connections` (문서상 `www.notion.so/developers` 도 동일 포털로 연결)
- [ ] 사이드바 **Build** 섹션에서 **Public connections** 선택
- [ ] **Create new connection** 클릭 후 필수 필드 입력:
  - **Connection name** (연결 이름) + **development workspace** (개발 워크스페이스)
  - **Redirect URI(s)** — OAuth 플로우용 (아래 2번)
  - **Installation scope** — **Any workspace** (Marketplace 등재 가능) 또는 **Selected workspaces only** (등재 불가) 중 택 1. **생성 후 변경 불가** — 문서 원문: "Installation scope is set once, at creation time, and can't be changed afterward." / "If you pick Selected workspaces only and later want to list on the Marketplace, create a new connection."
  - **Connection capabilities** (read content / update content / insert content 등)
- [ ] **"전환" 관련 주의**: 현행 공식 문서([internal-connections](https://developers.notion.com/guides/get-started/internal-connections), [public-connections](https://developers.notion.com/guides/get-started/public-connections))에는 **internal → public 전환 절차가 문서화되어 있지 않음**. 처음부터 public connection 으로 새로 생성하는 것이 문서화된 경로. (구 "Do you want to make this integration public?" 토글은 n8n 등 서드파티 구버전 가이드에만 남아 있음)

출처: [Public connections 가이드](https://developers.notion.com/guides/get-started/public-connections)

## 2. Redirect URI 등록 위치

- [ ] **생성 폼의 "Redirect URI(s)" 필드** (OAuth configuration 섹션)에 입력:
  ```
  https://oculpm.com/api/notion/oauth/callback
  ```
- 문서 원문: "fill out the form with your connection details, including your redirect URI(s) under the OAuth configuration section."
- 생성 후에는 해당 connection 의 **Configuration 탭**에서 관리.

출처: [Authorization 가이드](https://developers.notion.com/docs/authorization), [Public connections 가이드](https://developers.notion.com/guides/get-started/public-connections)

## 3. Client ID / Client Secret 위치

- [ ] 생성 완료 후 해당 connection 의 **Configuration 탭**에서 **OAuth client ID** 와 **OAuth client secret** 확인 — 문서 원문: "After creation, visit the Configuration tab to retrieve your OAuth client ID and OAuth client secret."
- 참고 (토큰 교환 시): `POST https://api.notion.com/v1/oauth/token` 에 **HTTP Basic Auth** — `base64(CLIENT_ID:CLIENT_SECRET)` 를 Authorization 헤더로. 인가 URL 은 `https://api.notion.com/v1/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&owner=user` (+선택 `state`).
- 주의: 문서상 "The Authorization URL field populates after a public connection is submitted for review" — Configuration 탭의 Authorization URL 필드는 리뷰 제출 후 채워짐.

출처: [Public connections 가이드](https://developers.notion.com/guides/get-started/public-connections), [Authorization 가이드](https://developers.notion.com/docs/authorization)

## 4. 승인 화면 이름/로고 설정

- [ ] 승인(동의) 화면에 대해 공식 문서가 확인해 주는 것: 사용자에게 **connection 의 capabilities 설명 + 페이지 선택기(page picker)** 가 표시됨 — "Notion presents a prompt describing the connection's capabilities — what it will be able to do in the user's workspace."
- [ ] 이름은 생성 시 **Connection name** 필드로 설정.
- [ ] 로고·설명·카테고리·이미지는 **Marketplace listing** 에서 별도 관리: Developer portal 의 **Listings > Connections** 섹션에서 "Listing name and description / Category and tags / Listing images and logo / 연결할 public connection" 을 입력, **Drafts** 저장 → 제출 → **Submitted** 에서 추적, 리뷰 피드백은 "within 5-10 business days via email".
- ⚠️ **문서로 확인 불가한 부분 (추측 금지 원칙에 따라 명시)**: 승인 화면 자체에 로고/회사명이 어떻게 노출되는지, 그리고 구 문서에 있던 company name·tagline·privacy policy·terms of use·support email 필드의 현행 포털 내 정확한 위치는 현재 공개 문서에 명시되어 있지 않음. 실제 생성 폼에서 확인 필요.

출처: [Marketplace listing 가이드](https://developers.notion.com/guides/get-started/marketplace-listing), [Authorization 가이드](https://developers.notion.com/docs/authorization)

## 5. Vercel(ocul-pm-landing) 환경변수 등록 + 재배포

- [ ] Vercel [dashboard](https://vercel.com/dashboard) → 팀 선택 → **ocul-pm-landing** 프로젝트 선택
- [ ] 사이드바에서 **Environment Variables** 선택 (Settings → Environment Variables)
- [ ] **Name** 에 `NOTION_OAUTH_CLIENT_ID`, **Value** 에 클라이언트 ID 입력 → 적용할 환경(**Production** / Preview / Development) 선택 → **Save**
- [ ] 같은 방식으로 `NOTION_OAUTH_CLIENT_SECRET` 추가 (값은 encrypted at rest — 문서 원문: "The value is encrypted at rest so it is safe to add sensitive data like authentication tokens or private keys.")
- [ ] **재배포 필수** — 문서 원문: "Changes to environment variables are not applied to previous deployments, they only apply to new deployments. You must redeploy your project to update the value of any variables you change in the deployment."
- [ ] 재배포 방법: 프로젝트 → 사이드바 **Deployments** → 대상 배포의 **ellipsis (…) 아이콘** → **Redeploy** → **Redeploy to Production** 창에서 Build Cache 사용 여부 결정 → **Redeploy** 클릭

출처: [Managing environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables), [Environment variables](https://vercel.com/docs/environment-variables), [Managing Deployments — Redeploy a project](https://vercel.com/docs/deployments/managing-deployments#redeploy-a-project)

---

Sources:
- [Notion — Public connections](https://developers.notion.com/guides/get-started/public-connections)
- [Notion — Authorization](https://developers.notion.com/docs/authorization)
- [Notion — Internal connections](https://developers.notion.com/guides/get-started/internal-connections)
- [Notion — Marketplace listing](https://developers.notion.com/guides/get-started/marketplace-listing)
- [Notion — Developer Platform 3.5 릴리스 (2026-05-13)](https://www.notion.com/releases/2026-05-13)
- [Vercel — Environment variables](https://vercel.com/docs/environment-variables)
- [Vercel — Managing environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables)
- [Vercel — Managing Deployments](https://vercel.com/docs/deployments/managing-deployments)
