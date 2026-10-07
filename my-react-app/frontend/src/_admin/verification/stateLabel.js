// 所有狀態的主標都是「待專家驗證」：目前沒有任何專家身分資料，意見只是意見，不是驗證結果。
export default function stateLabel(item) {
    if (item.review_state === 'conflicting_opinions') {
        return { text: `待專家驗證・意見不一致（${item.opinion_count} 則）`, variant: 'warning' };
    }
    if (item.review_state === 'opinions_recorded') {
        return { text: `待專家驗證・已有 ${item.opinion_count} 則意見`, variant: 'info' };
    }
    return { text: '待專家驗證', variant: 'secondary' };
}
