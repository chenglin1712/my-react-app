import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { apiPost } from "../utils/apiClient";

// 沒設定環境變數時退回預設路徑（跟 .env.example 的值相同），本機沒更新 .env 也能用。
const ANALYZE_URL = import.meta.env.VITE_API_MORPHOLOGY_ANALYZE_URL || "/api/v1/morphology/analyze";

/**
 * 詞形分析：輸入一個族語詞形，取得可能的詞根、詞綴切分、詞綴功能、辭典例句與信心。
 *
 * 快速連續分析、或換族語／換詞的時候，比較慢的舊請求可能在新請求之後才回來。
 * 每次呼叫都先中斷上一個請求，並用 generation 讓過期的回應不再更新畫面（同
 * _translate 頁的作法）。元件卸載時也會中斷進行中的請求。
 */
export function useMorphologyAnalysis() {
    const [state, setState] = useState({ loading: false, result: null, error: "" });
    const generationRef = useRef(0);
    const abortRef = useRef(null);

    const cancel = useCallback(() => {
        generationRef.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
    }, []);

    const analyze = useCallback(async (tribeSlug, word) => {
        const text = (word ?? "").trim();
        if (!text) return;

        cancel();
        const generation = generationRef.current;
        const controller = new AbortController();
        abortRef.current = controller;
        setState({ loading: true, result: null, error: "" });
        try {
            const data = await apiPost(ANALYZE_URL, { tribe: tribeSlug, word: text }, { signal: controller.signal });
            if (generation !== generationRef.current) return;
            setState({ loading: false, result: data, error: "" });
        } catch (err) {
            if (axios.isCancel(err) || generation !== generationRef.current) return;
            setState({ loading: false, result: null, error: err.message || "詞形分析失敗，請稍後再試" });
        }
    }, [cancel]);

    const reset = useCallback(() => {
        cancel();
        setState({ loading: false, result: null, error: "" });
    }, [cancel]);

    useEffect(() => cancel, [cancel]);

    return { ...state, analyze, reset };
}
