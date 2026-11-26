import { useEffect, useState } from 'react';
import {
    Alert, Button, Form, Spinner,
} from 'react-bootstrap';
import { Save } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import { formatApiError } from '../apiErrors';
import EditConflictAlert from '../components/EditConflictAlert';
import { isEditConflict } from '../hooks/editConflict';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { SuccessNotice } from '../components/AdminToast';

const PUBLISHERS = ['owner', 'admin'];
const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];

const EMPTY_CONFIG = {
    listening_questions_per_round: 0,
    listening_options_per_question: 0,
    sentence_questions_per_round: 0,
    sentence_options_per_question: 0,
    pronunciation_max_audio_mb: 0,
    pronunciation_excellent_threshold: 0,
    pronunciation_good_threshold: 0,
    pronunciation_fair_threshold: 0,
    pronunciation_pass_threshold: 0,
    crossword_grid_size: 0,
    crossword_min_word_length: 0,
    crossword_max_word_length: 0,
    crossword_words_per_round: 0,
    crossword_compute_time_limit_seconds: 0,
};

const CONFIG_SECTIONS = [
    {
        title: '聽力',
        fields: [
            ['listening_questions_per_round', '每輪題數'],
            ['listening_options_per_question', '每題選項數'],
        ],
    },
    {
        title: '句型',
        fields: [
            ['sentence_questions_per_round', '每輪題數'],
            ['sentence_options_per_question', '每題選項數'],
        ],
    },
    {
        title: '發音',
        fields: [
            ['pronunciation_max_audio_mb', '錄音檔大小上限 MB'],
            ['pronunciation_excellent_threshold', '「優秀」門檻分數'],
            ['pronunciation_good_threshold', '「不錯」門檻分數'],
            ['pronunciation_fair_threshold', '「繼續加油」門檻分數'],
            ['pronunciation_pass_threshold', '後端判定 passed 的門檻分數'],
        ],
    },
    {
        title: '填字',
        fields: [
            ['crossword_grid_size', '網格大小（正方形邊長）'],
            ['crossword_min_word_length', '候選詞最短長度'],
            ['crossword_max_word_length', '候選詞最長長度'],
            ['crossword_words_per_round', '每輪最多候選詞數'],
            ['crossword_compute_time_limit_seconds', '運算時限秒數'],
        ],
    },
];

// 各欄位的合法範圍，與後端 GameConfigSerializer 的 validate_* 一致（稽核 FE7a-11）。
// 前端先擋，清空欄位或超出範圍不會送出；後端仍會再驗一次。
const RANGES = {
    listening_questions_per_round: [1, 50],
    listening_options_per_question: [2, 8],
    sentence_questions_per_round: [1, 50],
    sentence_options_per_question: [2, 8],
    pronunciation_max_audio_mb: [1, 50],
    pronunciation_excellent_threshold: [0, 100],
    pronunciation_good_threshold: [0, 100],
    pronunciation_fair_threshold: [0, 100],
    pronunciation_pass_threshold: [0, 100],
    crossword_grid_size: [5, 30],
    crossword_min_word_length: [2, 20],
    crossword_max_word_length: [2, 20],
    crossword_words_per_round: [5, 200],
    crossword_compute_time_limit_seconds: [1, 10],
};

// 空字串、小數、非數字一律視為不合法（parseInt 會把 "3.5" 靜默截成 3、把 "" 變成 NaN 送出 null）
const parseWhole = (value) => (/^-?\d+$/.test(String(value).trim()) ? Number(value) : null);

function validateConfig(config) {
    const errors = {};
    Object.entries(RANGES).forEach(([field, [min, max]]) => {
        const n = parseWhole(config[field]);
        if (n === null) errors[field] = '請填入整數';
        else if (n < min || n > max) errors[field] = `必須介於 ${min} 到 ${max} 之間`;
    });
    if (!errors.pronunciation_good_threshold && !errors.pronunciation_excellent_threshold
        && !errors.pronunciation_fair_threshold) {
        const [e, g, f] = [
            config.pronunciation_excellent_threshold,
            config.pronunciation_good_threshold,
            config.pronunciation_fair_threshold,
        ].map(Number);
        if (!(e >= g && g >= f)) errors.pronunciation_good_threshold = '門檻須維持「優秀 ≥ 不錯 ≥ 繼續加油」的順序';
    }
    if (!errors.crossword_min_word_length && !errors.crossword_max_word_length
        && Number(config.crossword_min_word_length) > Number(config.crossword_max_word_length)) {
        errors.crossword_min_word_length = '詞長下限不能大於上限';
    }
    return errors;
}

const configFromResponse = (item) => Object.fromEntries(
    Object.keys(EMPTY_CONFIG).map((key) => [key, item[key] ?? EMPTY_CONFIG[key]]),
);

export default function GameSettings() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = PUBLISHERS.includes(role);
    const canView = STAFF_ROLES.includes(role);

    const [config, setConfig] = useState(EMPTY_CONFIG);
    const [metadata, setMetadata] = useState({ updated_by: '', updated_at: '' });
    const [loading, setLoading] = useState(true);
    const [savingConfig, setSavingConfig] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [savedConfig, setSavedConfig] = useState(EMPTY_CONFIG);
    const [showErrors, setShowErrors] = useState(false);
    const [conflict, setConflict] = useState(false);
    const [reloading, setReloading] = useState(false);

    const applyLoaded = (response) => {
        const next = configFromResponse(response);
        setConfig(next);
        setSavedConfig(next);
        setMetadata({
            updated_by: response.updated_by ?? '',
            updated_at: response.updated_at ?? '',
        });
    };

    useEffect(() => {
        let active = true;

        (async () => {
            try {
                const configResponse = await apiGet('/adminapi/game-config/');
                if (!active) return;

                applyLoaded(configResponse);
            } catch (err) {
                if (active) setError(formatApiError(err));
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, []);

    const errors = validateConfig(config);
    // WP-8 追加：欄位驗證摘要由目前欄位狀態即時推導（比照 HomepageConfig），欄位改對就自動消失；
    // 不寫進 error state，否則改對後仍會留著過期的錯誤，error 只放 API 回傳的錯誤。
    const validationSummary = showErrors && Object.keys(errors).length > 0 ? '有欄位需要修正，請看標示的欄位' : '';
    const changedFields = Object.keys(EMPTY_CONFIG).filter((key) => String(config[key]) !== String(savedConfig[key]));
    useUnsavedChangesGuard(changedFields.length > 0);

    const updateConfig = (field, value) => {
        setConfig((current) => ({ ...current, [field]: value }));
    };

    const saveConfig = async (event) => {
        event.preventDefault();
        setError('');
        setSuccess('');
        setConflict(false);
        if (Object.keys(errors).length > 0) {
            setShowErrors(true);
            return;
        }
        if (changedFields.length === 0) {
            setSuccess('沒有需要儲存的變更');
            return;
        }
        setSavingConfig(true);

        try {
            // 只送有改的欄位並帶載入時的 updated_at：期間別人改過就回 409，不會整包覆蓋（稽核 FE7a-11）
            const payload = {
                ...Object.fromEntries(changedFields.map((key) => [key, Number(config[key])])),
                ...(metadata.updated_at ? { base_updated_at: metadata.updated_at } : {}),
            };
            const saved = await apiPatch('/adminapi/game-config/', payload);
            applyLoaded(saved);
            setShowErrors(false);
            setSuccess('遊戲參數已儲存');
        } catch (err) {
            if (isEditConflict(err)) setConflict(true);
            else setError(formatApiError(err));
        } finally {
            setSavingConfig(false);
        }
    };

    const reloadLatest = async () => {
        setReloading(true);
        try {
            applyLoaded(await apiGet('/adminapi/game-config/'));
            setConflict(false);
            setShowErrors(false);
            setError('');
        } catch (err) {
            setError(formatApiError(err));
        } finally {
            setReloading(false);
        }
    };

    if (loading) {
        return (
            <div className="admin-loading">
                <Spinner animation="border" />
                <span>載入中…</span>
            </div>
        );
    }

    return (
        <main className="admin-page game-settings-page">
            <div className="admin-page-heading">
                <div>
                    <h1>遊戲參數設定</h1>
                    <p>聽力／句型／發音／填字四個遊戲的可調參數</p>
                </div>
            </div>

            {!canView && (
                <Alert variant="danger">你的角色沒有權限檢視這項設定。</Alert>
            )}
            {!editable && canView && (
                <Alert variant="warning">
                    你可以檢視目前的遊戲參數；只有擁有者或管理員可以變更。
                </Alert>
            )}
            {(error || validationSummary) && <Alert variant="danger" role="alert">{error || validationSummary}</Alert>}
            {conflict && <EditConflictAlert onReload={reloadLatest} busy={reloading} />}
            <SuccessNotice message={success} />

            <Form
                className="admin-config-card"
                noValidate
                onSubmit={saveConfig}
            >
                {CONFIG_SECTIONS.map((section) => (
                    <section className="admin-config-section" key={section.title}>
                        <div className="admin-config-section-heading">
                            <h2>{section.title}</h2>
                        </div>
                        <div className="admin-config-grid">
                            {section.fields.map(([field, label]) => (
                                <Form.Group
                                    controlId={`game-config-${field}`}
                                    key={field}
                                >
                                    <Form.Label>{`${section.title}：${label}`}</Form.Label>
                                    <Form.Control
                                        type="number"
                                        step="1"
                                        min={RANGES[field][0]}
                                        max={RANGES[field][1]}
                                        disabled={!editable}
                                        isInvalid={showErrors && Boolean(errors[field])}
                                        value={config[field]}
                                        onChange={(event) => updateConfig(
                                            field,
                                            event.target.value,
                                        )}
                                    />
                                    <Form.Control.Feedback type="invalid">{errors[field]}</Form.Control.Feedback>
                                </Form.Group>
                            ))}
                        </div>
                    </section>
                ))}

                <div className="admin-config-footer">
                    <span>
                        最後更新：
                        {metadata.updated_by || '尚無紀錄'}
                        {metadata.updated_at ? `・${metadata.updated_at}` : ''}
                    </span>
                    {editable && (
                        <Button type="submit" disabled={savingConfig}>
                            {savingConfig
                                ? <Spinner animation="border" size="sm" />
                                : <Save size={17} />}
                            {savingConfig ? '儲存中…' : '儲存設定'}
                        </Button>
                    )}
                </div>
            </Form>
        </main>
    );
}
