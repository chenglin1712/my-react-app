import { useEffect, useState } from 'react';
import {
    Alert, Button, Form, Spinner,
} from 'react-bootstrap';
import { Save } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPatch } from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-bank.css';

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

    useEffect(() => {
        let active = true;

        (async () => {
            try {
                const configResponse = await apiGet('/adminapi/game-config/');
                if (!active) return;

                setConfig(configFromResponse(configResponse));
                setMetadata({
                    updated_by: configResponse.updated_by ?? '',
                    updated_at: configResponse.updated_at ?? '',
                });
            } catch (err) {
                if (active) setError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, []);

    const updateConfig = (field, value) => {
        setConfig((current) => ({ ...current, [field]: value }));
    };

    const saveConfig = async (event) => {
        event.preventDefault();
        setError('');
        setSuccess('');
        setSavingConfig(true);

        try {
            const payload = Object.fromEntries(
                Object.entries(config).map(([key, value]) => [key, parseInt(value, 10)]),
            );
            const saved = await apiPatch('/adminapi/game-config/', payload);
            setConfig(configFromResponse(saved));
            setMetadata({
                updated_by: saved.updated_by ?? '',
                updated_at: saved.updated_at ?? '',
            });
            setSuccess('遊戲參數已儲存');
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingConfig(false);
        }
    };

    if (loading) {
        return (
            <div className="quiz-bank-loading">
                <Spinner animation="border" />
                <span>載入中…</span>
            </div>
        );
    }

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading">
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
            {error && <Alert variant="danger">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <Form
                className="quiz-bank-config-card"
                onSubmit={saveConfig}
            >
                {CONFIG_SECTIONS.map((section) => (
                    <section className="quiz-bank-config-section" key={section.title}>
                        <div className="quiz-bank-config-section-heading">
                            <h2>{section.title}</h2>
                        </div>
                        <div className="quiz-bank-config-grid">
                            {section.fields.map(([field, label]) => (
                                <Form.Group
                                    controlId={`game-config-${field}`}
                                    key={field}
                                >
                                    <Form.Label>{`${section.title}：${label}`}</Form.Label>
                                    <Form.Control
                                        type="number"
                                        step="1"
                                        disabled={!editable}
                                        value={config[field]}
                                        onChange={(event) => updateConfig(
                                            field,
                                            event.target.value,
                                        )}
                                    />
                                </Form.Group>
                            ))}
                        </div>
                    </section>
                ))}

                <div className="quiz-bank-config-footer">
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
