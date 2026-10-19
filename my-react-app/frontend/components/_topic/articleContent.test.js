import { describe, expect, test } from "vitest";
import { formatArticleDate, parseArticleBody } from "./articleContent";

describe("parseArticleBody", () => {
    test("空一行分段，段內單一換行保留", () => {
        expect(parseArticleBody("第一段\n\n第二段第一行\n第二段第二行")).toEqual([
            { type: "p", text: "第一段" },
            { type: "p", text: "第二段第一行\n第二段第二行" },
        ]);
    });

    test("「## 」開頭的行是小標，連在段落後面（沒有空行）也會獨立成區塊", () => {
        expect(parseArticleBody("## 小標\n內文\n## 另一個小標\n\n結尾")).toEqual([
            { type: "h2", text: "小標" },
            { type: "p", text: "內文" },
            { type: "h2", text: "另一個小標" },
            { type: "p", text: "結尾" },
        ]);
    });

    test("Windows 換行、全形空白的空行都能分段", () => {
        expect(parseArticleBody("甲\r\n\r\n乙\n　\n丙")).toEqual([
            { type: "p", text: "甲" }, { type: "p", text: "乙" }, { type: "p", text: "丙" },
        ]);
    });

    test("沒有空格的 ## 不是小標；HTML 當成純文字原樣保留", () => {
        expect(parseArticleBody("##沒空格\n\n<b>粗體</b><script>alert(1)</script>")).toEqual([
            { type: "p", text: "##沒空格" },
            { type: "p", text: "<b>粗體</b><script>alert(1)</script>" },
        ]);
    });

    test("空白、非字串、只有空行都回空陣列", () => {
        [undefined, null, 42, "", "   \n\n  \n"].forEach((value) => {
            expect(parseArticleBody(value)).toEqual([]);
        });
    });
});

describe("formatArticleDate", () => {
    test("YYYY-MM-DD 轉成中文日期，月日不補零", () => {
        expect(formatArticleDate("2026-10-09")).toBe("2026 年 10 月 9 日");
    });

    test("格式不對回空字串", () => {
        ["", "2026/10/09", "2026-10-09T00:00:00Z", null, undefined].forEach((value) => {
            expect(formatArticleDate(value)).toBe("");
        });
    });
});
