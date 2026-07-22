// @vitest-environment node
//
// Firestore 規則的行為測試。原本 CI 完全沒有涵蓋 firestore.rules——每次修規則
// 都是我手動跑 `firebase emulators:start` 確認語法沒錯，但語法正確不代表邏輯
// 正確：例如 sharedNotes 的 create 規則若被不小心改壞（uid 檢查被拿掉、或改成
// 永遠是 true），語法一樣合法，只有實際跑一次「用別人的 uid 建立文件應該被拒絕」
// 才抓得到。這裡直接對著模擬器跑真正的讀寫，驗證這波稽核修好的兩個
// sharedNotes 規則（作者身份、欄位/大小驗證）與既有的 quizs 規則沒有再被改壞。
//
// 執行方式：firebase emulators:exec --only firestore "npm run test:rules"
// （emulators:exec 會先啟動模擬器、跑完測試後自動關掉，不需要另外手動啟動）。
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';
import { readFileSync } from 'fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'yuanyu-app-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

const validQuiz = {
  title: '測驗標題',
  tribe: 'tayal',
  createdAt: serverTimestamp(),
  data: [{ q: '1' }],
};

const validSharedNote = (uid) => ({
  pages: [{ title: '第一頁', content: '<p>內容</p>' }],
  preview: '<p>內容</p>',
  uid,
  username: '測試使用者',
  createdAt: serverTimestamp(),
  likes: 0,
  likedBy: [],
  deleted: false,
});

describe('quizs create 規則', () => {
  test('已登入、內容完整合法時可以建立', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(setDoc(doc(alice.firestore(), 'quizs/q1'), validQuiz));
  });

  test('未登入不能建立', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(setDoc(doc(anon.firestore(), 'quizs/q1'), validQuiz));
  });

  test('缺少必填欄位（data）會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const { data: _drop, ...incomplete } = validQuiz;
    await assertFails(setDoc(doc(alice.firestore(), 'quizs/q1'), incomplete));
  });

  test('tribe 不在白名單內會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'quizs/q1'), { ...validQuiz, tribe: 'klingon' }));
  });

  test('createdAt 不是真正的伺服器時間會被拒絕（防偽造時間戳記）', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'quizs/q1'), { ...validQuiz, createdAt: new Date() }));
  });
});

describe('sharedNotes create 規則', () => {
  test('已登入、uid 是本人、內容完整合法時可以建立', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(setDoc(doc(alice.firestore(), 'sharedNotes/n1'), validSharedNote('alice')));
  });

  test('uid 冒充別人會被拒絕（這波修好的作者身份驗證）', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'sharedNotes/n1'), validSharedNote('bob')));
  });

  test('未登入不能建立', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(setDoc(doc(anon.firestore(), 'sharedNotes/n1'), validSharedNote('anyone')));
  });

  test('缺少必填欄位（pages）會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const { pages: _drop, ...incomplete } = validSharedNote('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'sharedNotes/n1'), incomplete));
  });

  test('建立時就帶正數 likes 會被拒絕（這波修好的初始狀態驗證）', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'sharedNotes/n1'), { ...validSharedNote('alice'), likes: 100 }));
  });

  test('建立時就標成 deleted:true 會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'sharedNotes/n1'), { ...validSharedNote('alice'), deleted: true }));
  });

  test('createdAt 不是真正的伺服器時間會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(doc(alice.firestore(), 'sharedNotes/n1'), { ...validSharedNote('alice'), createdAt: new Date() })
    );
  });
});

describe('sharedNotes read 規則（軟刪除）', () => {
  test('deleted:true 的筆記讀不到（即使知道文件 ID 直接讀取）', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'sharedNotes/deleted-note'), {
        ...validSharedNote('alice'),
        deleted: true,
      });
    });
    const bob = testEnv.authenticatedContext('bob');
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(bob.firestore(), 'sharedNotes/deleted-note')));
  });

  test('沒有 deleted 欄位的舊文件仍然讀得到（軟刪除上線前建立的資料不受影響）', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const { uid: _drop, ...legacyNote } = validSharedNote('alice');
      await setDoc(doc(ctx.firestore(), 'sharedNotes/legacy-note'), { uid: 'alice', ...legacyNote });
    });
    const bob = testEnv.authenticatedContext('bob');
    const { getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(bob.firestore(), 'sharedNotes/legacy-note')));
  });
});
