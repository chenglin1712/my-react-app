import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Alert,
    Badge,
    Button,
    Form,
    Spinner,
} from 'react-bootstrap';
import {
    ArrowDown,
    ArrowUp,
    Plus,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import {
    getGrammarSection,
    listGrammarSections,
    listTaxonomies,
    reorderGrammarSections,
} from './dictionaryApi';
import { confirmDiscardChanges } from '../hooks/useUnsavedChangesGuard';
import { canProposeDictionaryChanges } from './useRevisionActions';
import { REVISION_STATUS_META as REVISION_STATUSES } from './revisionMeta';
import { useActionLock } from '../hooks/useActionLock';
import GrammarNodePanel from './GrammarNodePanel';
import NewWordRevisions from './NewWordRevisions';
import '../../../static/css/_admin/dictionary.css';

function RevisionBadge({ revision }) {
    if (!revision) return null;

    const meta = REVISION_STATUSES[revision.status] ?? {
        label: revision.status,
        bg: 'secondary',
    };

    return (
        <Badge bg={meta.bg} text={meta.text}>
            {meta.label}
        </Badge>
    );
}

export default function GrammarTree() {
    const { userData } = useAuth();
    const role = userData?.role;
    const canEdit = canProposeDictionaryChanges(role);

    const [taxonomies, setTaxonomies] = useState({
        tribes: [],
        grammar_affix: [],
    });
    const [selectedTribeId, setSelectedTribeId] = useState('');
    // undefined 表示尚未選擇；null 表示新增章節；其他值表示既有章節。
    const [selectedSectionId, setSelectedSectionId] = useState(undefined);
    const [sections, setSections] = useState([]);
    const [loadingTaxonomies, setLoadingTaxonomies] = useState(true);
    const [loadingSections, setLoadingSections] = useState(false);
    const [error, setError] = useState('');
    // 稽核 FE7a-04：編輯面板回報有沒有未儲存變更；切換章節／族語／新增章節前先確認
    const panelDirtyRef = useRef(false);
    const handleDirtyChange = useCallback((value) => {
        panelDirtyRef.current = value;
    }, []);
    // 稽核 FE7a-16：只有使用者主動選章節時才把焦點移到面板（初次載入不搶焦點）
    const [focusPanel, setFocusPanel] = useState(false);
    // 從送審佇列或提案頁以 ?section= 開啟時，先換到該章節的族語再選取
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    // 稽核 FE7a-02：新建章節第一次存檔後換到提案專屬網址（比照詞條），離開後才找得回來
    const handleCreated = useCallback((revisionId) => {
        panelDirtyRef.current = false;
        // WP-8 追加：與新建詞條一致用 replace——上一頁回到「尚未存檔的新增章節」畫面沒有意義，
        // 且那個畫面再存一次會建立第二筆提案
        navigate(`/admin/dictionary/revisions/${revisionId}`, { replace: true, state: { flash: '草稿已儲存' } });
    }, [navigate]);
    const initialSectionRef = useRef(searchParams.get('section'));
    // 換章節排序是不是正在進行中，跟「切換族語」共用同一種同步鎖概念——
    // 用 ref 而不是單純的 state，才能擋住同一個 tick 內的重複觸發（例如
    // 雙擊上移/下移按鈕）。
    const reorderLock = useActionLock();
    const reordering = reorderLock.pendingKey === 'reorder';

    // 只有「目前最新的那一次章節清單查詢」可以寫回狀態：快速切換族語時，
    // 較舊的查詢若比較新的查詢晚回來，不能覆蓋新族語的清單。
    const sectionsRequestRef = useRef(0);

    useEffect(() => {
        let active = true;

        (async () => {
            setLoadingTaxonomies(true);
            setError('');

            try {
                const result = await listTaxonomies();
                if (!active) return;

                const nextTaxonomies = {
                    ...result,
                    tribes: result.tribes ?? [],
                    grammar_affix: result.grammar_affix ?? [],
                };

                setTaxonomies(nextTaxonomies);

                let initialTribe = nextTaxonomies.tribes[0]?.id;
                const initialSection = initialSectionRef.current;
                if (initialSection) {
                    try {
                        const section = await getGrammarSection(initialSection);
                        if (!active) return;
                        initialTribe = section.tribe_id ?? initialTribe;
                    } catch {
                        initialSectionRef.current = null;
                    }
                }

                if (initialTribe !== undefined && initialTribe !== null) {
                    setSelectedTribeId(String(initialTribe));
                }
            } catch (err) {
                if (active) setError(err.message);
            } finally {
                if (active) setLoadingTaxonomies(false);
            }
        })();

        return () => {
            active = false;
        };
    }, []);

    const loadSections = useCallback(async () => {
        const requestId = sectionsRequestRef.current + 1;
        sectionsRequestRef.current = requestId;
        const isStale = () => sectionsRequestRef.current !== requestId;

        if (!selectedTribeId) {
            setSections([]);
            return [];
        }

        setLoadingSections(true);
        setError('');

        try {
            const result = await listGrammarSections(selectedTribeId);
            if (isStale()) return [];

            const nextSections = [...(result.results ?? [])].sort(
                (left, right) => (left.section_order ?? 0) - (right.section_order ?? 0),
            );

            setSections(nextSections);
            setSelectedSectionId((current) => {
                if (current === undefined || current === null) return current;
                return nextSections.some((section) => String(section.id) === String(current))
                    ? current
                    : undefined;
            });

            return nextSections;
        } catch (err) {
            if (isStale()) return [];
            setError(err.message);
            return [];
        } finally {
            if (!isStale()) setLoadingSections(false);
        }
    }, [selectedTribeId]);

    useEffect(() => {
        // ?section= 要等族語確定（主檔載入完成）之後才套用，只用一次
        const initialSection = selectedTribeId ? initialSectionRef.current : null;
        if (selectedTribeId) initialSectionRef.current = null;
        setSelectedSectionId(initialSection ? Number(initialSection) : undefined);
        loadSections();
    }, [loadSections, selectedTribeId]);

    const confirmLeavePanel = async () => {
        if (!panelDirtyRef.current) return true;
        const confirmed = await confirmDiscardChanges();
        if (confirmed) panelDirtyRef.current = false;
        return confirmed;
    };

    const selectSection = async (next) => {
        if (next === selectedSectionId) return;
        if (!(await confirmLeavePanel())) return;
        setFocusPanel(true);
        setSelectedSectionId(next);
    };

    const hasPendingRevision = useMemo(
        () => sections.some((section) => section.pending_revision),
        [sections],
    );

    const moveSection = (index, delta) => {
        const nextIndex = index + delta;
        if (nextIndex < 0 || nextIndex >= sections.length || hasPendingRevision) {
            return Promise.resolve();
        }

        return reorderLock.runLocked('reorder', async () => {
            const reordered = sections.slice();
            const [section] = reordered.splice(index, 1);
            reordered.splice(nextIndex, 0, section);

            setError('');

            try {
                await reorderGrammarSections(selectedTribeId, reordered.map((item) => item.id));
                await loadSections();
            } catch (err) {
                setError(err.message);
            }
        });
    };

    const changeTribe = async (event) => {
        const nextTribe = event.target.value;
        if (!(await confirmLeavePanel())) return;
        setSelectedSectionId(undefined);
        setSelectedTribeId(nextTribe);
    };

    return (
        <main className="dictionary-admin-page">
            <div className="dictionary-page-heading">
                <div>
                    <h1>文法管理</h1>
                    <p>
                        依族語管理文法章節、規則與例句；內容異動需經送審，
                        章節顯示順序則直接更新。
                    </p>
                </div>
            </div>

            {error && <Alert variant="danger">{error}</Alert>}

            <NewWordRevisions kind="grammar_section" title="我的新建章節草稿與待審的新建章節" tribes={taxonomies.tribes} />

            <Form.Group className="dictionary-field" controlId="dictionary-grammar-tribe">
                <Form.Label>族語</Form.Label>
                <Form.Select
                    disabled={loadingTaxonomies}
                    value={selectedTribeId}
                    onChange={changeTribe}
                >
                    {taxonomies.tribes.length === 0 && (
                        <option value="">沒有可用族語</option>
                    )}
                    {taxonomies.tribes.map((tribe) => (
                        <option key={tribe.id} value={tribe.id}>
                            {tribe.name}
                        </option>
                    ))}
                </Form.Select>
            </Form.Group>

            <div className="dictionary-grammar-layout">
                <section className="dictionary-table-card">
                    <div className="dictionary-child-heading">
                        <h2>文法章節</h2>

                        {canEdit && (
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => selectSection(null)}
                            >
                                <Plus size={15} />
                                新增章節
                            </Button>
                        )}
                    </div>

                    {hasPendingRevision && canEdit && (
                        <Alert variant="secondary">
                            有章節正在提案流程中，完成或捨棄提案後才能調整順序。
                        </Alert>
                    )}

                    {loadingSections || loadingTaxonomies ? (
                        <div className="dictionary-loading">
                            <Spinner animation="border" size="sm" />
                            <span>載入文法章節中…</span>
                        </div>
                    ) : sections.length === 0 ? (
                        <div className="dictionary-empty">此族語尚未建立文法章節</div>
                    ) : (
                        <div className="dictionary-grammar-section-list">
                            {sections.map((section, index) => {
                                const isSelected = String(selectedSectionId) === String(section.id);
                                return (
                                <div
                                    key={section.id}
                                    className={`dictionary-nested-card${isSelected ? ' is-selected' : ''}`}
                                >
                                    <div className="dictionary-nested-heading">
                                        <Button
                                            type="button"
                                            variant="link"
                                            className="dictionary-grammar-section-link"
                                            // 稽核 FE7a-16：標示目前選取的章節
                                            aria-current={isSelected ? 'true' : undefined}
                                            onClick={() => selectSection(section.id)}
                                        >
                                            <strong>{section.title}</strong>
                                            <span className="d-block">
                                                規則 {section.rule_count ?? 0} 則
                                            </span>
                                        </Button>

                                        <RevisionBadge revision={section.pending_revision} />
                                    </div>

                                    {canEdit && (
                                        <div className="dictionary-row-actions">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline-secondary"
                                                aria-label={`上移章節 ${section.title}`}
                                                disabled={index === 0 || hasPendingRevision || reordering}
                                                onClick={() => moveSection(index, -1)}
                                            >
                                                <ArrowUp size={15} />
                                            </Button>

                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline-secondary"
                                                aria-label={`下移章節 ${section.title}`}
                                                disabled={
                                                    index === sections.length - 1
                                                    || hasPendingRevision
                                                    || reordering
                                                }
                                                onClick={() => moveSection(index, 1)}
                                            >
                                                <ArrowDown size={15} />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section>
                    {selectedSectionId === undefined ? (
                        <div className="dictionary-editor-card dictionary-empty">
                            從左側選擇章節，或新增章節
                        </div>
                    ) : (
                        <GrammarNodePanel
                            key={`${selectedTribeId}-${String(selectedSectionId)}`}
                            tribeId={selectedTribeId}
                            sectionId={selectedSectionId}
                            taxonomies={taxonomies}
                            onSaved={loadSections}
                            onDirtyChange={handleDirtyChange}
                            onCreated={handleCreated}
                            focusOnLoad={focusPanel}
                        />
                    )}
                </section>
            </div>
        </main>
    );
}
