import { Button } from 'react-bootstrap';

/**
 * 送審清單的分頁列（FE-2）——每個面板原本都各自 inline 寫一份完全相同的
 * 「共 N 筆 / 上一頁 / 第 N 頁 / 下一頁」。
 *
 * className 保留成參數，因為各頁面的 CSS class 命名不同
 * （quiz-bank-pagination／announcement-pagination…），不強迫統一樣式。
 */
export default function ReviewPagination({
    data,
    page,
    setPage,
    loading,
    hasNext,
    className = 'quiz-bank-pagination',
}) {
    return (
        <div className={className}>
            <span>共 {data.count} 筆</span>
            <div>
                <Button
                    variant="outline-secondary"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                >
                    上一頁
                </Button>
                <span>第 {data.page} 頁</span>
                <Button
                    variant="outline-secondary"
                    disabled={loading || !hasNext}
                    onClick={() => setPage((value) => value + 1)}
                >
                    下一頁
                </Button>
            </div>
        </div>
    );
}
