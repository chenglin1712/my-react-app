import { useEffect, useMemo, useState } from 'react';
import {
    Alert, Badge, Button, Form, Nav, Spinner, Table,
} from 'react-bootstrap';
import {
    GitMerge, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import {
    createTaxonomyTerm, deleteTaxonomyTerm, listTaxonomies, updateTaxonomyTerm,
} from './dictionaryApi';
import MergeDialog from './MergeDialog';
import '../../../static/css/_admin/dictionary.css';

// 跟 useRevisionActions.js 的既有慣例一樣：這幾個角色常數沒有集中成共用
// 模組，各檔案各自宣告同樣的字面值——主檔管理是完全不同的動作集合
// （建立/改名/刪除/合併，沒有送審狀態機），不借用那邊的常數。
const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
const ACCOUNT_MANAGERS = ['owner', 'admin'];

const KINDS = [
    { key: 'source', label: '來源' },
    { key: 'category', label: '分類' },
    { key: 'part_of_speech', label: '詞類' },
    { key: 'focus', label: '焦點' },
    { key: 'grammar_affix', label: '詞綴' },
];

// 跟 config/grammar_affixes.py 的 VALID_AFFIX_TYPES 同一份值——後端是這份
// 白名單唯一的驗證來源，這裡只是給下拉選單一個中文標籤，選錯值後端一樣
// 會擋（見 dictionary_serializers.GrammarAffixCreateSerializer）。
const AFFIX_TYPES = [
    { value: 'prefix', label: '前綴' },
    { value: 'suffix', label: '後綴' },
    { value: 'infix', label: '中綴' },
    { value: 'circumfix', label: '環綴' },
    { value: 'reduplication', label: '重疊' },
    { value: 'auxiliary', label: '助詞' },
];

const emptyAffixDraft = () => ({
    tribe_id: '', affix: '', affix_type: 'prefix', function: '', example_form: '',
});

export default function TaxonomyManager() {
    const { userData } = useAuth();
    const role = userData?.role;
    const canEdit = CONTENT_EDITORS.includes(role);
    const canMerge = ACCOUNT_MANAGERS.includes(role);

    const [activeKind, setActiveKind] = useState('source');
    const [taxonomies, setTaxonomies] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [newName, setNewName] = useState('');
    const [newAffix, setNewAffix] = useState(emptyAffixDraft());
    const [creating, setCreating] = useState(false);

    const [editingId, setEditingId] = useState(null);
    const [editDraft, setEditDraft] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);

    const [deletingId, setDeletingId] = useState(null);
    const [mergeSource, setMergeSource] = useState(null);

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            setTaxonomies(await listTaxonomies());
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const tribeNames = useMemo(() => new Map(
        (taxonomies?.tribes ?? []).map((tribe) => [String(tribe.id), tribe.name]),
    ), [taxonomies]);

    const activeKindMeta = KINDS.find((kind) => kind.key === activeKind);
    const isAffix = activeKind === 'grammar_affix';
    const rows = taxonomies?.[activeKind] ?? [];

    const selectKind = (key) => {
        setActiveKind(key);
        setEditingId(null);
        setEditDraft(null);
        setNewName('');
        setNewAffix(emptyAffixDraft());
        setError('');
    };

    const submitCreate = async (event) => {
        event.preventDefault();
        setCreating(true);
        setError('');
        try {
            if (isAffix) {
                await createTaxonomyTerm('grammar_affix', newAffix);
                setNewAffix(emptyAffixDraft());
            } else {
                await createTaxonomyTerm(activeKind, { name: newName.trim() });
                setNewName('');
            }
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setCreating(false);
        }
    };

    const startEdit = (row) => {
        setEditingId(row.id);
        setEditDraft(isAffix
            ? {
                affix: row.affix, affix_type: row.affix_type,
                function: row.function, example_form: row.example_form,
            }
            : { name: row.name });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditDraft(null);
    };

    const saveEdit = async (row) => {
        setSavingEdit(true);
        setError('');
        try {
            await updateTaxonomyTerm(activeKind, row.id, editDraft);
            cancelEdit();
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingEdit(false);
        }
    };

    const removeRow = async (row) => {
        const label = isAffix ? row.affix : row.name;
        if (!window.confirm(`確定要刪除「${label}」嗎？此操作無法復原。`)) return;

        setDeletingId(row.id);
        setError('');
        try {
            await deleteTaxonomyTerm(activeKind, row.id);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeletingId(null);
        }
    };

    const mergeOptions = mergeSource
        ? rows.filter((row) => (
            row.id !== mergeSource.id
            && (!isAffix || row.tribe_id === mergeSource.tribe_id)
        ))
        : [];

    return (
        <main className="dictionary-admin-page">
            <div className="dictionary-page-heading">
                <div>
                    <h1>主檔管理</h1>
                    <p>
                        管理來源／分類／詞類／焦點／詞綴主檔。有引用時無法直接刪除，
                        只能合併到另一筆；族語本身固定在系統設定裡，不在這裡管理。
                    </p>
                </div>
            </div>

            {error && (
                <Alert variant="danger" onClose={() => setError('')} dismissible>
                    {error}
                </Alert>
            )}

            <Nav
                variant="tabs"
                className="dictionary-taxonomy-tabs"
                activeKey={activeKind}
                onSelect={(key) => selectKind(key)}
            >
                {KINDS.map((kind) => (
                    <Nav.Item key={kind.key}>
                        <Nav.Link eventKey={kind.key}>{kind.label}</Nav.Link>
                    </Nav.Item>
                ))}
            </Nav>

            <div className="dictionary-table-card dictionary-taxonomy-card">
                {canEdit && (
                    <Form className="dictionary-taxonomy-create-form" onSubmit={submitCreate}>
                        {isAffix ? (
                            <div className="dictionary-taxonomy-affix-form-grid">
                                <Form.Group controlId="taxonomy-affix-tribe">
                                    <Form.Label>族語</Form.Label>
                                    <Form.Select
                                        value={newAffix.tribe_id}
                                        required
                                        onChange={(event) => setNewAffix((draft) => ({
                                            ...draft, tribe_id: event.target.value,
                                        }))}
                                    >
                                        <option value="">請選擇族語</option>
                                        {(taxonomies?.tribes ?? []).map((tribe) => (
                                            <option key={tribe.id} value={tribe.id}>{tribe.name}</option>
                                        ))}
                                    </Form.Select>
                                </Form.Group>

                                <Form.Group controlId="taxonomy-affix-affix">
                                    <Form.Label>詞綴</Form.Label>
                                    <Form.Control
                                        value={newAffix.affix}
                                        required
                                        placeholder="例如 m-"
                                        onChange={(event) => setNewAffix((draft) => ({
                                            ...draft, affix: event.target.value,
                                        }))}
                                    />
                                </Form.Group>

                                <Form.Group controlId="taxonomy-affix-type">
                                    <Form.Label>類型</Form.Label>
                                    <Form.Select
                                        value={newAffix.affix_type}
                                        onChange={(event) => setNewAffix((draft) => ({
                                            ...draft, affix_type: event.target.value,
                                        }))}
                                    >
                                        {AFFIX_TYPES.map((type) => (
                                            <option key={type.value} value={type.value}>{type.label}</option>
                                        ))}
                                    </Form.Select>
                                </Form.Group>

                                <Form.Group controlId="taxonomy-affix-function">
                                    <Form.Label>功能說明</Form.Label>
                                    <Form.Control
                                        value={newAffix.function}
                                        onChange={(event) => setNewAffix((draft) => ({
                                            ...draft, function: event.target.value,
                                        }))}
                                    />
                                </Form.Group>

                                <Form.Group controlId="taxonomy-affix-example">
                                    <Form.Label>範例</Form.Label>
                                    <Form.Control
                                        value={newAffix.example_form}
                                        onChange={(event) => setNewAffix((draft) => ({
                                            ...draft, example_form: event.target.value,
                                        }))}
                                    />
                                </Form.Group>

                                <Button
                                    type="submit"
                                    disabled={creating || !newAffix.tribe_id || !newAffix.affix.trim()}
                                >
                                    {creating ? <Spinner animation="border" size="sm" /> : <Plus size={16} />}
                                    新增詞綴
                                </Button>
                            </div>
                        ) : (
                            <Form.Group controlId="taxonomy-new-name">
                                <Form.Label>{`新增${activeKindMeta.label}`}</Form.Label>
                                <div className="dictionary-taxonomy-create-row">
                                    <Form.Control
                                        value={newName}
                                        placeholder="名稱"
                                        required
                                        onChange={(event) => setNewName(event.target.value)}
                                    />
                                    <Button type="submit" disabled={creating || !newName.trim()}>
                                        {creating ? <Spinner animation="border" size="sm" /> : <Plus size={16} />}
                                        新增
                                    </Button>
                                </div>
                            </Form.Group>
                        )}
                    </Form>
                )}

                {loading ? (
                    <div className="dictionary-loading">
                        <Spinner animation="border" />
                        <span>載入中…</span>
                    </div>
                ) : (
                    <Table responsive hover className="dictionary-table">
                        <thead>
                            <tr>
                                {isAffix && <th>族語</th>}
                                <th>{isAffix ? '詞綴' : '名稱'}</th>
                                {isAffix && <th>類型</th>}
                                {isAffix && <th>功能說明</th>}
                                <th>引用數</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length > 0 ? rows.map((row) => {
                                const isEditing = editingId === row.id;
                                const label = isAffix ? row.affix : row.name;

                                return (
                                    <tr key={row.id}>
                                        {isAffix && (
                                            <td>{tribeNames.get(String(row.tribe_id)) ?? row.tribe_id}</td>
                                        )}

                                        <td>
                                            {isEditing ? (
                                                <Form.Control
                                                    size="sm"
                                                    value={isAffix ? editDraft.affix : editDraft.name}
                                                    onChange={(event) => setEditDraft((draft) => ({
                                                        ...draft,
                                                        [isAffix ? 'affix' : 'name']: event.target.value,
                                                    }))}
                                                />
                                            ) : label}
                                        </td>

                                        {isAffix && (
                                            <td>
                                                {isEditing ? (
                                                    <Form.Select
                                                        size="sm"
                                                        value={editDraft.affix_type}
                                                        onChange={(event) => setEditDraft((draft) => ({
                                                            ...draft, affix_type: event.target.value,
                                                        }))}
                                                    >
                                                        {AFFIX_TYPES.map((type) => (
                                                            <option key={type.value} value={type.value}>
                                                                {type.label}
                                                            </option>
                                                        ))}
                                                    </Form.Select>
                                                ) : (
                                                    AFFIX_TYPES.find((type) => type.value === row.affix_type)?.label
                                                    ?? row.affix_type
                                                )}
                                            </td>
                                        )}

                                        {isAffix && (
                                            <td>
                                                {isEditing ? (
                                                    <Form.Control
                                                        size="sm"
                                                        value={editDraft.function}
                                                        onChange={(event) => setEditDraft((draft) => ({
                                                            ...draft, function: event.target.value,
                                                        }))}
                                                    />
                                                ) : (row.function || '—')}
                                            </td>
                                        )}

                                        <td>
                                            <Badge
                                                bg={row.reference_count > 0 ? 'info' : 'light'}
                                                text={row.reference_count > 0 ? undefined : 'dark'}
                                            >
                                                {row.reference_count}
                                            </Badge>
                                        </td>

                                        <td>
                                            <div className="dictionary-row-actions">
                                                {isEditing ? (
                                                    <>
                                                        <Button
                                                            size="sm"
                                                            variant="outline-primary"
                                                            disabled={savingEdit}
                                                            onClick={() => saveEdit(row)}
                                                        >
                                                            {savingEdit
                                                                ? <Spinner animation="border" size="sm" />
                                                                : '儲存'}
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="outline-secondary"
                                                            disabled={savingEdit}
                                                            onClick={cancelEdit}
                                                        >
                                                            <X size={14} />
                                                        </Button>
                                                    </>
                                                ) : canEdit && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline-secondary"
                                                        onClick={() => startEdit(row)}
                                                    >
                                                        <Pencil size={14} />
                                                        編輯
                                                    </Button>
                                                )}

                                                {canMerge && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline-primary"
                                                        onClick={() => setMergeSource(row)}
                                                    >
                                                        <GitMerge size={14} />
                                                        合併
                                                    </Button>
                                                )}

                                                {canEdit && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline-danger"
                                                        aria-label={`刪除${label}`}
                                                        disabled={row.reference_count > 0 || deletingId === row.id}
                                                        title={row.reference_count > 0
                                                            ? '仍被引用，無法刪除，請改用合併'
                                                            : undefined}
                                                        onClick={() => removeRow(row)}
                                                    >
                                                        {deletingId === row.id
                                                            ? <Spinner animation="border" size="sm" />
                                                            : <Trash2 size={14} />}
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan={isAffix ? 6 : 3} className="dictionary-empty">
                                        {`目前沒有${activeKindMeta.label}`}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                )}
            </div>

            {mergeSource && (
                <MergeDialog
                    kind={activeKind}
                    kindLabel={activeKindMeta.label}
                    isAffix={isAffix}
                    source={mergeSource}
                    options={mergeOptions}
                    onClose={() => setMergeSource(null)}
                    onMerged={() => {
                        setMergeSource(null);
                        load();
                    }}
                />
            )}
        </main>
    );
}
