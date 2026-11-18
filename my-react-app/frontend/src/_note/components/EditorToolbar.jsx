import { useEffect, useRef, useState } from "react";
import { Row, Col, Button } from "react-bootstrap";
import { Image as ImageIcon, Bold, Italic } from "lucide-react";
import { useNavbarOffset } from "../../hooks/useScrolledPast";

// 執行命令後以瀏覽器回報的實際狀態為準；查不到時（瀏覽器不支援）才改成反轉目前狀態
function readCommandState(command) {
  try {
    const state = document.queryCommandState?.(command);
    if (typeof state === "boolean") return state;
  } catch { /* 查不到就反轉 */ }
  return (previous) => !previous;
}

/**
 * 筆記編輯器上方的固定工具列（P5-1 精簡版）：粗斜體與上傳圖片。
 * 字級與顏色移到「選取文字時浮出的氣泡」（SelectionBubble）；這裡留粗斜體，是因為沒有選字、
 * 或手機上選字不方便時，仍有一個固定、永遠找得到的地方。
 */
export default function EditorToolbar({ execStyle, onImageFileSelected, isUploadingImage }) {
  const imageInputRef = useRef(null);
  // 監聽 selectionchange，讀出游標所在處是不是粗體、斜體
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  useEffect(() => {
    const sync = () => {
      try {
        setIsBold(Boolean(document.queryCommandState?.("bold")));
        setIsItalic(Boolean(document.queryCommandState?.("italic")));
      } catch {
        setIsBold(false);
        setIsItalic(false);
      }
    };
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, []);
  // 工具列是 sticky：要釘在全站導覽列「下面」。原本 top: 0 會被導覽列蓋住，捲動時整條工具列看不見。
  const navbarOffset = useNavbarOffset();

  return (
    <Row className="editor-toolbar" style={{ top: navbarOffset }}>
      <Col xs="auto" className="group">
        {/* 原本用數學字母符號 𝐁 𝑰 當圖示，Noto Sans TC 沒有這些字形會顯示成方框（審查項 P3-27） */}
        <Button type="button" className="btn-ghost" aria-pressed={isBold} onClick={() => { execStyle("bold"); setIsBold(readCommandState("bold")); }} aria-label="粗體"><Bold size={18} aria-hidden="true" /></Button>
        <Button type="button" className="btn-ghost" aria-pressed={isItalic} onClick={() => { execStyle("italic"); setIsItalic(readCommandState("italic")); }} aria-label="斜體"><Italic size={18} aria-hidden="true" /></Button>
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
    </Row>
  );
}
