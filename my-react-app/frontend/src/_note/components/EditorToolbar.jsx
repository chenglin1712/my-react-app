import { Row, Col, Button } from "react-bootstrap";
import { Image as ImageIcon } from "lucide-react";

const COLOR_LABELS = { red: "紅色", blue: "藍色", black: "黑色", orange: "橘色" };

/** 筆記編輯器上方的工具列：字級、粗斜體、上傳圖片、文字顏色。 */
export default function EditorToolbar({ execStyle, onImageFileSelected }) {
  return (
    <Row className="editor-toolbar">
      <Col xs="auto" className="group">
        <label htmlFor="note-font-size-select" className="group-label">大小</label>
        <select id="note-font-size-select" onChange={(e) => execStyle("fontSize", e.target.value)} defaultValue="24px">
          <option value="16px">小</option>
          <option value="24px">中</option>
          <option value="32px">大</option>
        </select>
      </Col>
      <Col xs="auto" className="group">
        <Button className="btn-ghost" onClick={() => execStyle("bold")} aria-label="粗體">𝐁</Button>
        <Button className="btn-ghost" onClick={() => execStyle("italic")} aria-label="斜體">𝑰</Button>
      </Col>
      <Col xs="auto" className="group">
        <input
          type="file"
          accept="image/*"
          id="image-upload"
          style={{ display: "none" }}
          aria-label="上傳圖片"
          onChange={(e) => {
            const file = e.target.files[0];
            if (file) onImageFileSelected(file);
          }}
        />
        <Button
          className="btn-upload"
          onClick={() => document.getElementById("image-upload").click()}
        >
          <ImageIcon size={20} />上傳圖片
        </Button>
      </Col>
      <Col xs="auto" className="group">
        {["red", "blue", "black", "orange"].map((color) => (
          <button
            key={color}
            type="button"
            className="color-box"
            style={{ backgroundColor: color, width: 40, height: 6, border: "none", borderRadius: "6px" }}
            onClick={() => execStyle("foreColor", color)}
            aria-label={`文字顏色：${COLOR_LABELS[color]}`}
          />
        ))}
      </Col>
    </Row>
  );
}
