const pct = (value) => `${(value * 100).toFixed(1)}%`;

// 比率物件 {k, n, value, lo, hi}；分母為 0 時 value 為 null，顯示「無資料」，不是 0%。
export default function formatRatio(ratio) {
    if (!ratio) return '—';
    if (ratio.value === null || ratio.value === undefined) return '無資料';
    return `${pct(ratio.value)}（${pct(ratio.lo)}–${pct(ratio.hi)}）`;
}
