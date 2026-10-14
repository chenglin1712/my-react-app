// @vitest-environment node
//
// N-6／F-2 族群資料單一來源與用字守門。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tribeJson from "../../../backend/config/tribes.json";
import {
  ALL_TRIBES,
  TRIBES,
  TRIBE_FULL_NAME_BY_SLUG,
  TRIBE_NAME_BY_SLUG,
  buildTribeTables,
  tribeHasFeature,
  tribeLangCode,
} from "./tribes";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..", "..");

describe("族群資料單一來源", () => {
  it("目前啟用的仍是原本 5 族，順序與識別色不變", () => {
    expect(TRIBES.map((t) => t.slug)).toEqual(["tayal", "amis", "bunun", "kavalan", "paiwan"]);
    expect(TRIBES.map((t) => t.color)).toEqual(["#9E1B24", "#1F3A5C", "#4B6B3A", "#2C6E7F", "#D9A227"]);
    expect(TRIBES.map((t) => t.roman)).toEqual(["Tayal", "Pangcah", "Bunun", "Kebalan", "Payuan"]);
  });

  it("預留官方承認的 16 族，其餘 11 族不進入選單", () => {
    expect(ALL_TRIBES).toHaveLength(16);
    expect(TRIBES).toHaveLength(5);
    expect(ALL_TRIBES.filter((t) => !t.enabled)).toHaveLength(11);
    expect(new Set(ALL_TRIBES.map((t) => t.slug)).size).toBe(16);
  });

  it("新增一個族群只改 JSON 一處，選單、名稱表與功能判斷都跟著出現", () => {
    const extra = {
      slug: "demo", name: "測試", fullName: "測試語", roman: "Demo", color: "#123456",
      langCode: null, id: "00000000-0000-0000-0000-000000000001", enabled: true,
      features: { quiz: true },
    };
    const { enabled } = buildTribeTables([...tribeJson.tribes, extra]);
    expect(enabled.map((t) => t.slug)).toContain("demo");
    expect(enabled.find((t) => t.slug === "demo").features.quiz).toBe(true);
  });

  it("啟用的族群缺少顯示必要欄位時直接報錯", () => {
    expect(() => buildTribeTables([{ slug: "x", name: "某", enabled: true }])).toThrow(/fullName/);
  });

  it("沒有內容的功能不是 true，畫面顯示「即將推出」", () => {
    const { enabled } = buildTribeTables([
      { slug: "demo", name: "測試", fullName: "測試語", roman: "Demo", color: "#123456", enabled: true, features: { quiz: true } },
    ]);
    const demo = enabled[0];
    expect(demo.features.quiz).toBe(true);
    expect(demo.features.vocabulary).toBeUndefined();
    // 原本 5 族的所有功能都維持有內容
    for (const t of TRIBES) {
      for (const f of ["dictionary", "quiz", "vocabulary", "listening", "pronunciation", "sentence"]) {
        expect(tribeHasFeature(t.slug, f)).toBe(true);
      }
    }
    expect(tribeHasFeature("不存在", "quiz")).toBe(false);
  });
});

describe("族名用字與語言代碼（F-2）", () => {
  it("噶瑪蘭使用官方用字，顯示名稱不含舊寫法「葛」", () => {
    expect(TRIBE_NAME_BY_SLUG.kavalan).toBe("噶瑪蘭");
    expect(TRIBE_FULL_NAME_BY_SLUG.kavalan).toBe("噶瑪蘭語");
  });

  it("5 族語言代碼為 ISO 639-3，查不到時回傳 und 而不是亂猜", () => {
    expect(["tayal", "amis", "bunun", "kavalan", "paiwan"].map(tribeLangCode)).toEqual(["tay", "ami", "bnn", "ckv", "pwn"]);
    expect(tribeLangCode("不存在")).toBe("und");
  });

  it("前台原始碼（不含測試）沒有舊寫法「葛瑪蘭」", () => {
    const walk = (dir) =>
      readdirSync(dir).flatMap((name) => {
        if (name === "node_modules") return [];
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.(jsx?|css)$/.test(full) && !/\.(test|spec)\./.test(full) ? [full] : [];
      });
    const hits = walk(FRONTEND)
      .filter((f) => readFileSync(f, "utf8").includes("葛瑪蘭"))
      .map((f) => relative(FRONTEND, f));
    expect(hits).toEqual([]);
  });

  it("族語文字不再一律標 lang=und（翻譯逐詞與詞形分析都帶入實際語別）", () => {
    const read = (rel) => readFileSync(join(FRONTEND, rel), "utf8");
    expect(read("components/_translate/GroundedText.jsx")).not.toMatch(/lang="und"/);
    expect(read("components/_morphology/MorphologyResult.jsx")).not.toMatch(/lang="und"/);
  });
});
