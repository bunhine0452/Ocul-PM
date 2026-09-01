// A2 (#a2-skills-activation) — 앱 스킬 갤러리(CI5)와 플러그인 동봉 스킬의
// 이중 소스 방지. 플러그인 파일이 SSOT 다: 갤러리 문자열이 플러그인 SKILL.md 와
// 바이트 단위로 일치해야 한다 (한쪽만 고치면 이 테스트가 깨진다).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { GALLERY_SKILLS } from "@/features/skills/skillsGallery";

// vitest 는 리포 루트에서 돈다 (jsdom 환경이라 import.meta.url 은 file: 이 아님).
const pluginSkillsDir = join(process.cwd(), "plugin", "oculpm", "skills");
const landingPlugin = join(process.cwd(), "landing", "plugin.html");

describe("plugin skills sync (플러그인이 SSOT)", () => {
  test.each(GALLERY_SKILLS.map((s) => [s.id, s] as const))(
    "갤러리 %s == plugin/oculpm/skills/%s/SKILL.md",
    (id, skill) => {
      const onDisk = readFileSync(join(pluginSkillsDir, id, "SKILL.md"), "utf8");
      expect(onDisk).toBe(skill.content);
    },
  );
});

// Osaurus 라운드 Phase 8 `#landing-skills` — 웹에서 앱으로 오는 길이 실제로
// 있는지. 딥링크는 **무확인 실행 0** 이라 앱을 열어 확인 창을 띄우는 데까지만
// 하지만, 링크 자체가 없으면 사용자는 파일을 손으로 만들어야 한다.
describe("landing/plugin.html 동봉 스킬 동기", () => {
  const page = readFileSync(landingPlugin, "utf8");

  test.each(GALLERY_SKILLS.map((s) => [s.id] as const))("%s 에 딥링크와 원문 링크가 있다", (id) => {
    expect(page, `${id} 딥링크 누락`).toContain(
      `oculpm://skill/install?source=bunhine0452/Ocul-PM&amp;name=${id}`,
    );
    expect(page, `${id} SKILL.md 링크 누락`).toContain(
      `/blob/main/plugin/oculpm/skills/${id}/SKILL.md`,
    );
  });
});
