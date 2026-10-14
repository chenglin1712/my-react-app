import { Spinner } from 'react-bootstrap';

/**
 * 全站共用的載入中圖示（原本各頁直接用 react-bootstrap 的 Spinner：沒有名稱、顏色也不一致，
 * 放進按鈕取代文字時，按鈕就沒有可讀的名稱了）。
 *
 * 三種用法：
 * - 預設：獨立出現的載入中（整頁、區塊載入）。包一層 role="status"，報讀器會唸出 label。
 * - announce={false}：放在按鈕裡取代文字。不另外播報，只留下藏起來的 label 當按鈕的名稱。
 * - decorative：旁邊已經有看得見的載入文字（例如「翻譯中…」），圖示本身只是裝飾，完全不給報讀器。
 */
export default function LoadingSpinner({
  size, variant = 'primary', label = '載入中…', announce = true, decorative = false, className,
}) {
  const spinner = (
    <Spinner as="span" animation="border" size={size} variant={variant} aria-hidden="true" className={className} />
  );

  if (decorative) return spinner;

  const hiddenLabel = <span className="visually-hidden">{label}</span>;
  if (!announce) {
    return (
      <>
        {spinner}
        {hiddenLabel}
      </>
    );
  }

  return (
    <span role="status" className="yy-loading">
      {spinner}
      {hiddenLabel}
    </span>
  );
}
