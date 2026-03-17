import "../../static/css/_quiz/review_page.css";

const Page = ({ currentPage, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null;

    const handlePrev = () => {
        if (currentPage > 1) onPageChange(currentPage - 1);
    };

    const handleNext = () => {
        if (currentPage < totalPages) onPageChange(currentPage + 1);
    };

    return (
        <div className="pagination">
            <button onClick={handlePrev} disabled={currentPage === 1}>
                上一頁
            </button>

            <span>
                {currentPage} / {totalPages}
            </span>

            <button onClick={handleNext} disabled={currentPage === totalPages}>
                下一頁
            </button>
        </div>
    );
};

export default Page;