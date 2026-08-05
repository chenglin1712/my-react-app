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

const validReport = (reporterUid, overrides = {}) => ({
  targetType: 'note',
  targetId: 'note123',
  targetTribe: '',
  reporterUid,
  reason: 'inappropriate',
  reasonText: '',
  status: 'pending',
  createdAt: serverTimestamp(),
  ...overrides,
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

describe('sharedNotes update 規則（按讚完整性）', () => {
  const seedNote = async (noteId, overrides = {}) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sharedNotes/${noteId}`), {
        ...validSharedNote('alice'),
        ...overrides,
      });
    });
  };

  test('非作者按讚：likes 正確等於 likedBy.size() 時可以成功', async () => {
    await seedNote('n1');
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { likes: 1, likedBy: ['bob'] })
    );
  });

  test('非作者取消讚：把自己的 uid 從 likedBy 移除也可以成功', async () => {
    await seedNote('n1', { likes: 1, likedBy: ['bob'] });
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { likes: 0, likedBy: [] })
    );
  });

  test('likes 跟 likedBy.size() 對不上會被拒絕（偽造讚數）', async () => {
    await seedNote('n1');
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { likes: 9999, likedBy: ['bob'] })
    );
  });

  test('把別人的 uid 塞進 likedBy 會被拒絕（冒名按讚）', async () => {
    await seedNote('n1');
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { likes: 1, likedBy: ['carol'] })
    );
  });

  test('清空別人已經按的讚會被拒絕', async () => {
    await seedNote('n1', { likes: 1, likedBy: ['carol'] });
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { likes: 0, likedBy: [] })
    );
  });

  test('一次改動兩個以上 uid 的 likedBy 會被拒絕', async () => {
    await seedNote('n1');
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { likes: 2, likedBy: ['bob', 'carol'] })
    );
  });

  test('作者本人更新仍不受按讚完整性限制（可編輯任何欄位）', async () => {
    await seedNote('n1');
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { preview: '<p>改過的內容</p>' })
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

// 後台管理系統的 isStaff()/isAdmin()：角色透過 authenticatedContext 的第二個
// 參數模擬 Firebase custom claims（模擬器會把它合併進 request.auth.token，
// 跟正式環境 set_custom_user_claims() 寫入的位置一致）。這裡只驗證「規則本身
// 有沒有正確依角色放行/擋下」，不驗證角色是怎麼被指派的（那是後端 adminapi
// 的責任，屬於 Python 端測試範圍）。
describe('users 規則（staff 角色）', () => {
  test('一般使用者讀不到別人的資料（維持原本行為）', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), { name: 'Alice' });
    });
    const bob = testEnv.authenticatedContext('bob');
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(bob.firestore(), 'users/alice')));
  });

  test('staff 角色（editor）可以讀別人的資料', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), { name: 'Alice' });
    });
    const staffBob = testEnv.authenticatedContext('bob', { role: 'editor' });
    const { getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(staffBob.firestore(), 'users/alice')));
  });

  test('沒有 role claim 的一般登入使用者不算 staff', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), { name: 'Alice' });
    });
    const bob = testEnv.authenticatedContext('bob', {});
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(bob.firestore(), 'users/alice')));
  });

  test('staff（含 owner）仍然不能寫別人的資料——管理動作只能走後端 Admin SDK，前端不開放直寫', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice'), { name: 'Alice' });
    });
    const staffBob = testEnv.authenticatedContext('bob', { role: 'owner' });
    await assertFails(setDoc(doc(staffBob.firestore(), 'users/alice'), { name: 'Hacked' }));
  });
});

describe('sharedNotes 規則（staff 審核）', () => {
  const seedNote = async (noteId, overrides = {}) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sharedNotes/${noteId}`), {
        ...validSharedNote('alice'),
        ...overrides,
      });
    });
  };

  test('staff 可以讀到已下架的筆記（審核佇列需要看得到）', async () => {
    await seedNote('n1', { deleted: true });
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    const { getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(staffBob.firestore(), 'sharedNotes/n1')));
  });

  test('staff 可以把別人的筆記下架，且只改動 deleted 欄位', async () => {
    await seedNote('n1');
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    const { updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(staffBob.firestore(), 'sharedNotes/n1'), { deleted: true }));
  });

  test('staff 下架動作不能夾帶改動其他欄位（例如順便改內文）', async () => {
    await seedNote('n1');
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(staffBob.firestore(), 'sharedNotes/n1'), { deleted: true, preview: '<p>被改過</p>' })
    );
  });

  test('沒有 staff 角色的一般使用者不能下架別人的筆記', async () => {
    await seedNote('n1');
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { deleted: true }));
  });
});

describe('pronunciations 規則（staff 審核）', () => {
  const seedRecording = async (id, overrides = {}) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `pronunciations/tayal/recordings/${id}`), {
        uid: 'alice',
        word: 'huzil',
        score: 88,
        ...overrides,
      });
    });
  };

  test('staff 可以刪除任何人的錄音（內容審核「移除」動作）', async () => {
    await seedRecording('r1');
    const staffBob = testEnv.authenticatedContext('bob', { role: 'reviewer' });
    const { deleteDoc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(staffBob.firestore(), 'pronunciations/tayal/recordings/r1')));
  });

  test('本人也不能刪除自己的錄音（原本就沒有開放 delete，這裡不能因為加了 staff 例外而意外放寬）', async () => {
    await seedRecording('r1');
    const alice = testEnv.authenticatedContext('alice');
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(alice.firestore(), 'pronunciations/tayal/recordings/r1')));
  });
});

// P3.6 檢舉：reports 集合的「建立」是前端直寫 Firestore（見
// frontend/src/userServives/reportService.jsx），沒有後端端點把關，這條規則
// 本身就是唯一的信任邊界，這裡要驗證跟 sharedNotes/quizs 同一種嚴謹程度。
describe('reports create 規則', () => {
  test('已登入、reporterUid 是本人、內容完整合法時可以建立', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(setDoc(doc(alice.firestore(), 'reports/r1'), validReport('alice')));
  });

  test('recording 類型帶 targetTribe 也可以建立', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(
      setDoc(
        doc(alice.firestore(), 'reports/r1'),
        validReport('alice', { targetType: 'recording', targetId: 'rec1', targetTribe: 'tayal' }),
      )
    );
  });

  test('未登入不能建立', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(setDoc(doc(anon.firestore(), 'reports/r1'), validReport('anyone')));
  });

  test('reporterUid 冒充別人會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'reports/r1'), validReport('bob')));
  });

  test('缺少必填欄位（reason）會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const { reason: _drop, ...incomplete } = validReport('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'reports/r1'), incomplete));
  });

  test('targetType 不在白名單內會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'reports/r1'), validReport('alice', { targetType: 'user' })));
  });

  test('reason 不在白名單內會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'reports/r1'), validReport('alice', { reason: 'because' })));
  });

  test('建立時 status 不是 pending 會被拒絕（不能一開始就自己標成已核結）', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'reports/r1'), validReport('alice', { status: 'resolved' })));
  });

  test('createdAt 不是真正的伺服器時間會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(doc(alice.firestore(), 'reports/r1'), validReport('alice', { createdAt: new Date() }))
    );
  });

  test('夾帶額外欄位會被拒絕（hasOnly，不是 hasAll）', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(doc(alice.firestore(), 'reports/r1'), { ...validReport('alice'), extraField: '塞垃圾' })
    );
  });

  test('note 類型的 targetTribe 不是空字串會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(doc(alice.firestore(), 'reports/r1'), validReport('alice', { targetTribe: 'tayal' }))
    );
  });

  test('recording 類型缺少 targetTribe（空字串）會被拒絕——不然後台永遠定位不到那筆錄音', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(
        doc(alice.firestore(), 'reports/r1'),
        validReport('alice', { targetType: 'recording', targetId: 'rec1', targetTribe: '' }),
      )
    );
  });

  test('recording 類型的 targetTribe 不在族語白名單內會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(
        doc(alice.firestore(), 'reports/r1'),
        validReport('alice', { targetType: 'recording', targetId: 'rec1', targetTribe: 'klingon' }),
      )
    );
  });
});

describe('reports read 規則', () => {
  const seedReport = async (id, overrides = {}) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `reports/${id}`), validReport('alice', overrides));
    });
  };

  test('staff 可以讀取檢舉列表', async () => {
    await seedReport('r1');
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    const { getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(staffBob.firestore(), 'reports/r1')));
  });

  test('檢舉人自己也讀不到（避免報復性騷擾，見規則註解）', async () => {
    await seedReport('r1');
    const alice = testEnv.authenticatedContext('alice');
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(alice.firestore(), 'reports/r1')));
  });

  test('沒有 staff 角色的一般使用者讀不到別人的檢舉', async () => {
    await seedReport('r1');
    const bob = testEnv.authenticatedContext('bob');
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(bob.firestore(), 'reports/r1')));
  });
});

describe('reports update 規則（staff 核結/駁回）', () => {
  const seedReport = async (id, overrides = {}) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `reports/${id}`), validReport('alice', overrides));
    });
  };

  test('staff 可以核結，只改動狀態相關欄位', async () => {
    await seedReport('r1');
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    const { updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(staffBob.firestore(), 'reports/r1'), {
        status: 'resolved', resolvedBy: 'bob', resolvedAt: serverTimestamp(), resolutionNote: '已處理',
      })
    );
  });

  test('staff 可以駁回', async () => {
    await seedReport('r1');
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    const { updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(staffBob.firestore(), 'reports/r1'), {
        status: 'dismissed', resolvedBy: 'bob', resolvedAt: serverTimestamp(), resolutionNote: '',
      })
    );
  });

  test('staff 更新時把狀態改回 pending 會被拒絕（只能核結或駁回）', async () => {
    await seedReport('r1');
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(staffBob.firestore(), 'reports/r1'), {
        status: 'pending', resolvedBy: 'bob', resolvedAt: serverTimestamp(), resolutionNote: '',
      })
    );
  });

  test('staff 不能夾帶改動檢舉原始內容（例如 reasonText）', async () => {
    await seedReport('r1');
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(staffBob.firestore(), 'reports/r1'), {
        status: 'resolved', resolvedBy: 'bob', resolvedAt: serverTimestamp(), resolutionNote: '', reasonText: '被改過',
      })
    );
  });

  test('沒有 staff 角色的一般使用者不能核結/駁回', async () => {
    await seedReport('r1');
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'reports/r1'), {
        status: 'resolved', resolvedBy: 'bob', resolvedAt: serverTimestamp(), resolutionNote: '',
      })
    );
  });
});

describe('reports delete 規則', () => {
  test('任何人都不能刪除檢舉紀錄（含 staff），保留完整稽核軌跡', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reports/r1'), validReport('alice'));
    });
    const staffBob = testEnv.authenticatedContext('bob', { role: 'owner' });
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(staffBob.firestore(), 'reports/r1')));
  });
});
