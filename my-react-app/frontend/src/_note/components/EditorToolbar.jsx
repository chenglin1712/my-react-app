import { useEffect, useRef, useState } from "react";
import { Row, Col, Button } from "react-bootstrap";
import { Image as ImageIcon } from "lucide-react";
import { useNavbarOffset } from "../../hooks/useScrolledPast";

// 色票改用品牌色盤 token（審查項 P1-18）：原本直接拿 red/blue/orange 當 CSS 色，不在品牌色盤內。
// value 是寫進筆記內容的實際色碼；筆記內容是存下來的資料，所以用色碼而不是 var()。
const COLOR_SWATCHES = [
  { id: "red", label: "紅色", value: "#9E1B24" },
  { id: "blue", label: "藍色", value: "#1F3A5C" },
  { id: "black", label: "黑色", value: "#221812" },
  { id: "orange", label: "橘色", value: "#C4601A" },
];

// queryCommandValue 在各瀏覽器可能回 "rgb(r, g, b)" 或 "#rrggbb"，統一換成色票 id
function swatchIdFromColor(raw) {
  if (!raw || typeof raw !== "string") return null;
  let hex = raw.trim().toLowerCase();
  const m = hex.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) hex = "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  return COLOR_SWATCHES.find((s) => s.value.toLowerCase() === hex)?.id ?? null;
}

/** 筆記編輯器上方的工具列：字級、粗斜體、上傳圖片、文字顏色。 */
export default function EditorToolbar({ execStyle, onImageFileSelected, isUploadingImage }) {
  const imageInputRef = useRef(null);
  // 選取狀態要反映「游標所在處的實際文字顏色」，不是最後點過哪顆：
  // 監聽 selectionchange，用 queryCommandValue 讀出顏色再對應回色票。
  const [activeColor, setActiveColor] = useState(null);
  useEffect(() => {
    const sync = () => {
      try {
        const rgb = document.queryCommandValue?.("foreColor");
        setActiveColor(swatchIdFromColor(rgb));
      } catch { setActiveColor(null); }
    };
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, []);
  // 工具列是 sticky：要釘在全站導覽列「下面」。原本 top: 0 會被導覽列蓋住，捲動時整條工具列看不見。
  const navbarOffset = useNavbarOffset();

  return (
    <Row className="editor-toolbar" style={{ top: navbarOffset }}>
      <Col xs="auto" className="group">
        <label htmlFor="note-font-size-select" className="group-label">大小</label>
        <select id="note-font-size-select" onChange={(e) => execStyle("fontSize", e.target.value)} defaultValue="24px">
          <option value="16px">小</option>
          <option value="24px">中</option>
          <option value="32px">大</option>
        </select>
      </Col>
      <Col xs="auto" className="group">
        <Button type="button" className="btn-ghost" onClick={() => execStyle("bold")} aria-label="粗體">𝐁</Button>
        <Button type="button" className="btn-ghost" onClick={() => execStyle("italic")} aria-label="斜體">𝑰</Button>
      </Col>
      <Col xs="auto" className="group">
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          aria-label="上傳圖片"
          onChange={(e) => {
            const file = e.target.files[0];
            e.target.value = ""; // 清空，這樣連續選同一個檔案也會觸發 change
            if (file) onImageFileSelected(file);
          }}
        />
        <Button
          type="button"
          className="btn-upload"
          disabled={isUploadingImage}
          onClick={() => imageInputRef.current?.click()}
        >
          <ImageIcon size={20} />{isUploadingImage ? "上傳中…" : "上傳圖片"}
        </Button>
      </Col>
      <Col xs="auto" className="group" role="group" aria-label="文字顏色">
        {COLOR_SWATCHES.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            className="color-box"
            style={{ "--swatch": swatch.value }}
            aria-pressed={activeColor === swatch.id}
            onClick={() => {
              setActiveColor(swatch.id);
              execStyle("foreColor", swatch.value);
            }}
            aria-label={`文字顏色：${swatch.label}`}
          />
        ))}
      </Col>
    </Row>
  );
}
