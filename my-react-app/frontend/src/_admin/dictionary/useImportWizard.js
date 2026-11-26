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

const REVOKE_DELAY_MS = 1000;

// 稽核 BE2b-11：後端 Django 的 DATA_UPLOAD_MAX_MEMORY_SIZE 預設 10 MB（core/settings.py，
// 可用 DJANGO_DATA_UPLOAD_MAX_MB 調整），nginx 的 client_max_body_size 是 12m。
// 超過時伺服器直接拒絕，畫面只會看到籠統的錯誤，所以在瀏覽器端先用「實際要送出的
// JSON 大小」檢查（上傳的是重新序列化後的 bundle，不是原始檔，縮排會被去掉）。
export const MAX_IMPORT_UPLOAD_BYTES = 10 * 1024 * 1024;
// 原始檔大到這個程度就不讀進記憶體解析了（避免整個分頁卡住），直接請使用者分批。
const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;

const formatMegabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const tooLargeMessage = (bytes) => (
    `檔案過大（約 ${formatMegabytes(bytes)}），單次匯入上限為 ${formatMegabytes(MAX_IMPORT_UPLOAD_BYTES)}，`
    + '請把詞條拆成多個檔案分批匯入。'
);

/** 與 apiClient 送出的請求本體相同的序列化方式，算出實際會送出的位元組數。 */
export const importPayloadBytes = (filename, bundle) => (
    new Blob([JSON.stringify({ filename, bundle })]).size
);

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

        if (file.size > MAX_IMPORT_FILE_BYTES) {
            setError(tooLargeMessage(file.size));
            return;
        }

        const reader = new FileReader();

        reader.onload = () => {
            if (generation !== fileReadGenerationRef.current || !mountedRef.current) return;

            let bundle;
            try {
                bundle = JSON.parse(reader.result);
            } catch {
                setError('檔案不是有效的 JSON');
                return;
            }

            // 稽核 BE2b-11：超過伺服器上限就不讓「上傳」可按，避免送出後才失敗
            const bytes = importPayloadBytes(file.name, bundle);
            if (bytes > MAX_IMPORT_UPLOAD_BYTES) {
                setError(tooLargeMessage(bytes));
                return;
            }
            setParsedBundle(bundle);
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
                if (!mountedRef.current) return;
                // 伺服器上限若被調得比前端常數更小，仍以 413／400 拒絕；給出一樣明確的分批建議
                setError(err.status === 413
                    ? '檔案超過伺服器允許的大小，請把詞條拆成多個檔案分批匯入。'
                    : err.message);
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
                // 稽核 FE7a-21：部分瀏覽器（Firefox）要求 anchor 在文件裡才會觸發下載；
                // 點擊後立刻 revoke 也可能讓下載還沒開始就被取消，所以延後到下一輪再釋放。
                anchor.style.display = 'none';
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
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
