import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
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
    listGrammarSections,
    listTaxonomies,
    reorderGrammarSections,
} from './dictionaryApi';
import { canProposeDictionaryChanges } from './useRevisionActions';
import GrammarNodePanel from './GrammarNodePanel';
import '../../../static/css/_admin/dictionary.css';

const REVISION_STATUSES = {
    draft: {
        label: '草稿',
        bg: 'secondary',
    },
    pending_review: {
        label: '送審中',
        bg: 'warning',
        text: 'dark',
    },
    approved: {
        label: '已核准',
        bg: 'success',
    },
    rejected: {
        label: '已退件',
        bg: 'danger',
    },
};

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
    const [reordering, setReordering] = useState(false);
    const [error, setError] = useState('');

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

                if (nextTaxonomies.tribes.length > 0) {
                    setSelectedTribeId(String(nextTaxonomies.tribes[0].id));
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
        if (!selectedTribeId) {
            setSections([]);
            return [];
        }

        setLoadingSections(true);
        setError('');

        try {
            const result = await listGrammarSections(selectedTribeId);
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
            setError(err.message);
            return [];
        } finally {
            setLoadingSections(false);
        }
    }, [selectedTribeId]);

    useEffect(() => {
        setSelectedSectionId(undefined);
        loadSections();
    }, [loadSections]);

    const hasPendingRevision = useMemo(
        () => sections.some((section) => section.pending_revision),
        [sections],
    );

    const moveSection = async (index, delta) => {
        const nextIndex = index + delta;
        if (nextIndex < 0 || nextIndex >= sections.length || hasPendingRevision || reordering) {
            return;
        }

        const reordered = sections.slice();
        const [section] = reordered.splice(index, 1);
        reordered.splice(nextIndex, 0, section);

        setReordering(true);
        setError('');

        try {
            await reorderGrammarSections(selectedTribeId, reordered.map((item) => item.id));
            await loadSections();
        } catch (err) {
            setError(err.message);
        } finally {
            setReordering(false);
        }
    };

    const changeTribe = (event) => {
        setSelectedSectionId(undefined);
        setSelectedTribeId(event.target.value);
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
                                onClick={() => setSelectedSectionId(null)}
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
                            {sections.map((section, index) => (
                                <div key={section.id} className="dictionary-nested-card">
                                    <div className="dictionary-nested-heading">
                                        <Button
                                            type="button"
                                            variant="link"
                                            className="dictionary-grammar-section-link"
                                            onClick={() => setSelectedSectionId(section.id)}
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
                            ))}
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
                        />
                    )}
                </section>
            </div>
        </main>
    );
}
