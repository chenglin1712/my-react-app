// @vitest-environment node
//
// G-3 後台響應式守門（審查項 P2-80、P2-81）。
// 規則：900px 以下側欄收成可開關的選單（收起時不能被 Tab 到）；後台表格一律用 AdminTable，
// 不再直接用 react-bootstrap 的 <Table responsive>（它的捲動區沒有名稱、鍵盤無法捲動）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, "..", "..");
const ADMIN_SRC = join(FRONTEND, "src", "_admin");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

describe("後台側欄在窄螢幕收合（P2-80）", () => {
  const layout = readFileSync(join(ROOT, "_admin", "layout.css"), "utf8");
  const narrow = layout.slice(layout.indexOf("@media (max-width: 900px) {\n  .admin-main-column"));

  it("900px 以下主欄不留側欄寬度，側欄預設移出畫面並 visibility:hidden", () => {
    expect(narrow).toMatch(/\.admin-main-column\s*\{\s*margin-left:\s*0;/);
    expect(narrow).toMatch(/\.admin-sidebar\s*\{[^}]*transform:\s*translateX\(-100%\)/);
    expect(narrow).toMatch(/\.admin-sidebar\s*\{[^}]*visibility:\s*hidden/);
  });

  it("展開時側欄可見，開關與關閉鈕至少 44px", () => {
    expect(narrow).toMatch(/\.admin-shell\.is-nav-open \.admin-sidebar\s*\{[^}]*visibility:\s*visible/);
    expect(narrow).toMatch(/\.admin-nav-toggle,\s*\n\s*\.admin-nav-close\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  });

  it("寬螢幕不顯示開關、關閉鈕與背景", () => {
    expect(layout).toMatch(/\.admin-nav-toggle,\s*\n\.admin-nav-close,\s*\n\.admin-nav-backdrop\s*\{\s*display:\s*none;/);
  });

  it("尊重降低動態偏好", () => {
    expect(layout).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.admin-sidebar[^}]*transition:\s*none/s);
  });
});

describe("後台表格統一用 AdminTable（P2-81）", () => {
  it("後台程式不再直接使用 <Table responsive>", () => {
    const hits = [];
    walk(ADMIN_SRC).forEach((file) => {
      if (!/\.jsx$/.test(file) || /\.test\./.test(file)) return;
      const src = readFileSync(file, "utf8");
      if (/<Table[\s>]/.test(src) && !file.endsWith("AdminTable.jsx")) hits.push(relative(FRONTEND, file));
    });
    expect(hits).toEqual([]);
  });

  it("每張 AdminTable 都有 label（報讀名稱）", () => {
    const hits = [];
    walk(ADMIN_SRC).forEach((file) => {
      if (!/\.jsx$/.test(file) || /\.test\./.test(file) || file.endsWith("AdminTable.jsx")) return;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<AdminTable(\s[^>]*)?>/g)) {
        if (!/\blabel="[^"]+"/.test(m[1] || "")) hits.push(relative(FRONTEND, file));
      }
    });
    expect(hits).toEqual([]);
  });
});
