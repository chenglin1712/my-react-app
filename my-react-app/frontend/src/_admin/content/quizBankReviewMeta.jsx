import { Badge } from 'react-bootstrap';

/**
 * 題庫審定流程共用的角色門檻與狀態徽章。
 *
 * QuizBank.jsx／QuizChoice.jsx／QuizTrueFalse.jsx／QuizSituations.jsx 原本
 * 各自宣告一份逐字相同的 QUIZ_BANK_ROLES／STATUSES（QuizSituations.jsx
 * 甚至留了「跟 QuizBank.jsx 同一個理由」的註解）。這四個檔案都是同一個
 * 題庫審定語意，不是巧合相同的不同權限域——不像 TaxonomyManager.jsx 的
 * 主檔合併權限，那邊的值目前剛好跟帳號管理一樣，但語意上是兩件事。
 *
 * 核准／退件／下架用 approvers（含 reviewer），不是公告管理用的
 * publishers——族語老師（reviewer）必須能核准題庫內容，這是整個審定
 * 流程存在的意義。
 */
export const QUIZ_BANK_EDITORS = ['owner', 'admin', 'editor'];

export const QUIZ_BANK_ROLES = {
    editors: QUIZ_BANK_EDITORS,
    approvers: ['owner', 'admin', 'reviewer'],
    publishers: ['owner', 'admin'],
};

export const QUIZ_BANK_STATUSES = {
    draft: { label: '草稿', bg: 'secondary' },
    pending_review: { label: '待審核', bg: 'warning' },
    rejected: { label: '已退件', bg: 'danger' },
    published: { label: '已啟用', bg: 'success' },
};

export function QuizStatusBadge({ item }) {
    return (
        <div className="d-flex flex-wrap align-items-center gap-1">
            <Badge bg={QUIZ_BANK_STATUSES[item.status]?.bg ?? 'secondary'}>
                {QUIZ_BANK_STATUSES[item.status]?.label ?? item.status}
            </Badge>
            {item.status === 'published' && item.has_pending_revision && (
                <Badge bg="warning" text="dark">有待審修改</Badge>
            )}
        </div>
    );
}

export default QUIZ_BANK_ROLES;
