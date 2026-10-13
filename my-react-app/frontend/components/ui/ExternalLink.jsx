/**
 * 外部連結的共用元件（審查項 P2-8、P2-23）。
 *   1. 另開新視窗的連結一律附 visually-hidden 提示，報讀器使用者才知道會離開目前頁面
 *   2. 沒有網址（空字串、undefined）或不是 http(s) 的項目不渲染成連結：
 *      空的 href 會在新分頁開啟「目前這一頁」，javascript: 之類的網址更不該被點到。
 *      改渲染成 fallback 元素（預設 span），樣式 class 照舊，只是不可點。
 */
import { isExternalUrl } from './externalUrl';

export default function ExternalLink({ href, className, as: Fallback = 'span', children, ...rest }) {
  if (!isExternalUrl(href)) {
    return <Fallback className={className}>{children}</Fallback>;
  }
  return (
    <a href={href.trim()} className={className} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
      <span className="visually-hidden">（另開新視窗）</span>
    </a>
  );
}
