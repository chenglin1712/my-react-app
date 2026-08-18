/**
 * 後台角色常數（FE-6 順手處理）。
 *
 * ROLE_LABELS 原本在 AdminLayout.jsx／UserDetail.jsx／UserList.jsx／
 * UserCreate.jsx 各寫了一份一模一樣的對照表；角色清單也散在各個頁面頂端。
 * 這幾份必須永遠一致（同一個 role 字串在不同頁面顯示成不同中文會直接誤導
 * 管理者），所以集中成一份。
 *
 * 對應後端 backend/config/roles.py 的同名常數——後端才是權限的實際判斷處，
 * 前端這份只影響「畫面上顯示什麼、哪些按鈕出現」。
 */

export const OWNER = 'owner';
export const ADMIN = 'admin';
export const EDITOR = 'editor';
export const REVIEWER = 'reviewer';
export const ANALYST = 'analyst';

/** 所有能進後台的角色（一般使用者沒有 role claim，不在這份清單內）。 */
export const STAFF_ROLES = [OWNER, ADMIN, EDITOR, REVIEWER, ANALYST];

/** 可以指派／收回他人角色的角色——刻意只有 owner。 */
export const ROLE_ASSIGNERS = [OWNER];

/** 可以管理使用者帳號的角色。 */
export const ACCOUNT_MANAGERS = [OWNER, ADMIN];

export const ROLE_LABELS = {
    [OWNER]: '擁有者',
    [ADMIN]: '管理員',
    [EDITOR]: '內容編輯',
    [REVIEWER]: '審核者',
    [ANALYST]: '數據觀察者',
};
