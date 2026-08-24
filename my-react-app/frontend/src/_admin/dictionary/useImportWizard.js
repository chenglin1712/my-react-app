import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
    exportDictionary,
    getImportJob,
    listImportJobs,
    listTaxonomies,
    uploadImportJob,
} from './dictionaryApi';
import { useActionLock } from '../hooks/useActionLock';

const EMPTY_JOBS = { results: [], count: 0, page: 1, page_size: 20 };

/**
 * 批次匯入／匯出精靈的資料與流程（FE-9）。
 *
 * ImportWizard.jsx 原本把四步精靈的全部狀態（主檔清單、選中的族語、匯入
 * 工作清單、目前這一筆工作、選中的檔案、解析後的 bundle、審核意見、載入中、
 * 進行中的動作、錯誤、成功訊息）跟每一步的 render 函式全部放在同一個元件裡。
 *
 * 這個 hook 只接手「跟後端往返」的部分。每一步畫面長什麼樣、哪個角色看得到
 * 哪顆按鈕，留在元件裡——那是精靈的流程呈現，跟資料存取是兩回事。
 *
 * runJobAction 是這裡的核心：所有狀態轉換（預檢、送審、撤回、核准、退件、
 * 自動建立主檔）都共用同一套「標記進行中 → 清空訊息 → 執行 → 換掉目前工作
 * 並重載清單 → 收尾」，呼叫端只要傳入實際要打的那一支 API。
 */
export function useImportWizard({ id }) {
    const navigate = useNavigate();

    const [taxonomies, setTaxonomies] = useState({ tribes: [] });
    const [selectedTribe, setSelectedTribe] = useState('');
    const [jobs, setJobs] = useState(EMPTY_JOBS);
    const [job, setJob] = useState(null);

    const [selectedFile, setSelectedFile] = useState(null);
    const [parsedBundle, setParsedBundle] = useState(null);
    const [reviewComment, setReviewComment] = useState('');

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // 預檢／送審／撤回／核准／退件／自動建立主檔／上傳／匯出彼此都應該
    // 互斥，共用同一把鎖——而不是像原本那樣用一個 pendingAction state 當
    // 忙碌旗標（那樣擋不住同一個 tick 內的重複觸發）。pendingAction 這個
    // 名稱繼續沿用，值就是目前鎖住的動作名稱，呼叫端（ImportWizard.jsx）
    // 不需要跟著改。
    const lock = useActionLock();
    const pendingAction = lock.pendingKey ?? '';

    // 元件卸載後，還在飛的請求 resolve 時不能再 setState。
    const mountedRef = useRef(true);
    useEffect(() => () => { mountedRef.current = false; }, []);

    const loadJobs = useCallback(async () => {
        const result = await listImportJobs();
        if (!mountedRef.current) return;
        setJobs({ ...EMPTY_JOBS, ...result, results: result.results ?? [] });
    }, []);

    useEffect(() => {
        let active = true;

        (async () => {
            setLoading(true);
            setError('');

            try {
                const requests = [listTaxonomies(), listImportJobs()];
                if (id) requests.push(getImportJob(id));

                const [taxonomyResult, jobsResult, jobResult] = await Promise.all(requests);
                if (!active) return;

                setTaxonomies({ tribes: taxonomyResult.tribes ?? [] });
                setSelectedTribe((current) => current || taxonomyResult.tribes?.[0]?.slug || '');
                setJobs({ ...EMPTY_JOBS, ...jobsResult, results: jobsResult.results ?? [] });
                setJob(jobResult ?? null);
                setReviewComment(jobResult?.review_comment ?? '');
            } catch (err) {
                if (active) setError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => { active = false; };
    }, [id]);

    const tribeNames = useMemo(() => new Map(
        taxonomies.tribes.flatMap((tribe) => [
            [String(tribe.id), tribe.name],
            [String(tribe.slug), tribe.name],
        ]),
    ), [taxonomies.tribes]);

    const replaceJob = async (result, message = '') => {
        if (!mountedRef.current) return;
        setJob(result);
        if (message) setSuccessMessage(message);
        await loadJobs();
    };

    const runJobAction = (action, callback, message = '') => lock.runLocked(action, async () => {
        setError('');
        setSuccessMessage('');

        try {
            const result = await callback();
            await replaceJob(result, message);
        } catch (err) {
            if (mountedRef.current) setError(err.message);
        }
    });

    // 快速換選兩個檔案時，較晚完成的 reader.onload 不能覆蓋較新那次選檔
    // 的 parsedBundle——不然會出現「檔名是後選的 B、內容卻是先選的 A」
    // 一起送出去的情況。
    const fileReadGenerationRef = useRef(0);

    const handleFileChange = (event) => {
        const file = event.target.files?.[0];
        const generation = (fileReadGenerationRef.current += 1);

        setSelectedFile(file ?? null);
        setParsedBundle(null);
        setError('');
        setSuccessMessage('');

        if (!file) return;

        const reader = new FileReader();

        reader.onload = () => {
            if (generation !== fileReadGenerationRef.current || !mountedRef.current) return;

            try {
                setParsedBundle(JSON.parse(reader.result));
            } catch {
                setError('檔案不是有效的 JSON');
            }
        };

        reader.onerror = () => {
            if (generation !== fileReadGenerationRef.current || !mountedRef.current) return;
            setError('無法讀取檔案');
        };

        reader.readAsText(file);
    };

    const upload = () => {
        if (!selectedFile || !parsedBundle) return Promise.resolve();

        return lock.runLocked('upload', async () => {
            setError('');
            setSuccessMessage('');

            try {
                const result = await uploadImportJob(selectedFile.name, parsedBundle);
                // rowErrors 只在剛上傳完這一次顯示，用 route state 帶過去
                // （見 ImportWizard.jsx 對 location.state 的說明）。
                navigate(`/admin/dictionary/import/${result.id}`, {
                    state: { rowErrors: result.row_errors ?? {} },
                });
            } catch (err) {
                if (mountedRef.current) setError(err.message);
            }
        });
    };

    const exportBundle = () => {
        if (!selectedTribe) return Promise.resolve();

        return lock.runLocked('export', async () => {
            setError('');
            setSuccessMessage('');

            try {
                const data = await exportDictionary(selectedTribe);
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');

                anchor.href = url;
                anchor.download = `dictionary_${selectedTribe}.json`;
                anchor.click();

                URL.revokeObjectURL(url);
                if (mountedRef.current) setSuccessMessage('辭典匯出檔已開始下載。');
            } catch (err) {
                if (mountedRef.current) setError(err.message);
            }
        });
    };

    return {
        taxonomies,
        tribeNames,
        selectedTribe,
        setSelectedTribe,
        jobs,
        job,
        selectedFile,
        parsedBundle,
        reviewComment,
        setReviewComment,
        loading,
        pendingAction,
        error,
        setError,
        successMessage,
        // auto-create 那一步要自己組一段「建立了哪些主檔」的訊息，
        // 不是 runJobAction 的固定字串，所以 setter 也一起給呼叫端。
        setSuccessMessage,
        runJobAction,
        handleFileChange,
        upload,
        exportBundle,
    };
}

export default useImportWizard;
