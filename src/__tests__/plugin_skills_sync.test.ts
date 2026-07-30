// A2 (#a2-skills-activation) — 앱 스킬 갤러리(CI5)와 플러그인 동봉 스킬의
// 이중 소스 방지. 플러그인 파일이 SSOT 다: 갤러리 문자열이 플러그인 SKILL.md 와
// 바이트 단위로 일치해야 한다 (한쪽만 고치면 이 테스트가 깨진다).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { GALLERY_SKILLS } from "@/features/skills/skillsGallery";

// vitest 는 리포 루트에서 돈다 (jsdom 환경이라 import.meta.url 은 file: 이 아님).
const pluginSkillsDir = join(process.cwd(), "plugin", "oculpm", "skills");

describe("plugin skills sync (플러그인이 SSOT)", () => {
  test.each(GALLERY_SKILLS.map((s) => [s.id, s] as const))(
    "갤러리 %s == plugin/oculpm/skills/%s/SKILL.md",
    (id, skill) => {
      const onDisk = readFileSync(join(pluginSkillsDir, id, "SKILL.md"), "utf8");
      expect(onDisk).toBe(skill.content);
    },
  );
});
