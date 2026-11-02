import { describe, expect, test } from "vitest";
import { mapAnnouncementToNewsItem } from "./announcementContent";

const base = { id: 1, title: "t", category: "activity", publish_at: "2026-01-02T00:00:00Z" };

describe("mapAnnouncementToNewsItem 封面圖（稽核 FE-3）", () => {
    test("https 封面圖保留", () => {
        const item = mapAnnouncementToNewsItem({ ...base, cover_image_url: "https://res.cloudinary.com/demo/a.png" });
        expect(item.image).toBe("https://res.cloudinary.com/demo/a.png");
    });

    test.each([
        "javascript:alert(1)",
        "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        "http://example.com/a.png",
        "//example.com/a.png",
        "https://",
        "https://user:pw@example.com/a.png",
        "https://example.com\\@evil.example/a.png",
        "/relative.png",
        "",
        null,
        undefined,
    ])("不安全或空的封面圖 %s 不顯示", (url) => {
        expect(mapAnnouncementToNewsItem({ ...base, cover_image_url: url }).image).toBeNull();
    });

    test("連結原樣帶出，空值變空字串", () => {
        expect(mapAnnouncementToNewsItem({ ...base, link_url: "https://example.com/x" }).detail).toBe("https://example.com/x");
        expect(mapAnnouncementToNewsItem({ ...base }).detail).toBe("");
    });
});
