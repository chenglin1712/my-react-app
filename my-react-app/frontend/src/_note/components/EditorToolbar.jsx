import { useRef } from "react";
import { useEditorState } from "@tiptap/react";
import { Row, Col, Button } from "react-bootstrap";
import { Image as ImageIcon, Bold, Italic } from "lucide-react";
import { useNavbarOffset } from "../../hooks/useScrolledPast";

/**
 * 筆記編輯器上方的固定工具列（P5-1 精簡版）：粗斜體與上傳圖片。
 * 字級與顏色移到「選取文字時浮出的氣泡」（SelectionBubble）；這裡留粗斜體，是因為沒有選字、
 * 或手機上選字不方便時，仍有一個固定、永遠找得到的地方。
 */
export default function EditorToolbar({ editor, execStyle, onImageFileSelected, isUploadingImage }) {
  const imageInputRef = useRef(null);
  // 稽核 FE6-16：粗體／斜體狀態改訂閱 TipTap 編輯器本身（與 SelectionBubble 同一來源）。
  // 原本用 document.queryCommandState（已棄用）讀 DOM：沒選字時切換只會設 stored marks，
  // DOM 沒有 <strong>，按鈕會一直報「未按下」。
  const { isBold, isItalic } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      isBold: Boolean(e?.isActive("bold")),
      isItalic: Boolean(e?.isActive("italic")),
    }),
  }) ?? { isBold: false, isItalic: false };
  // 工具列是 sticky：要釘在全站導覽列「下面」。原本 top: 0 會被導覽列蓋住，捲動時整條工具列看不見。
  const navbarOffset = useNavbarOffset();

  return (
    <Row className="editor-toolbar" style={{ top: navbarOffset }}>
      <Col xs="auto" className="group">
        {/* 原本用數學字母符號 𝐁 𝑰 當圖示，Noto Sans TC 沒有這些字形會顯示成方框（審查項 P3-27） */}
        <Button type="button" className="btn-ghost" aria-pressed={isBold} onClick={() => execStyle("bold")} aria-label="粗體"><Bold size={18} aria-hidden="true" /></Button>
        <Button type="button" className="btn-ghost" aria-pressed={isItalic} onClick={() => execStyle("italic")} aria-label="斜體"><Italic size={18} aria-hidden="true" /></Button>
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
