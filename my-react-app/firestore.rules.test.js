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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';

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

  test('likedBy 帶重複的自己 uid 灌 likes 會被拒絕（獨立審查覆核找到的問題：'
    + 'toSet() 去重後只看到一個 uid、但 likes 卻能對到未去重的原始筆數）', async () => {
    await seedNote('n1');
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { likes: 2, likedBy: ['bob', 'bob'] })
    );
  });

  test('已經有讚的筆記，再塞重複的新 uid 一樣會被拒絕', async () => {
    await seedNote('n1', { likes: 1, likedBy: ['carol'] });
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { likes: 3, likedBy: ['carol', 'bob', 'bob'] })
    );
  });

  test('作者不能對自己的筆記按讚（跟 noteshare.jsx 的 isMine 判斷一致）', async () => {
    await seedNote('n1');
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { likes: 1, likedBy: ['alice'] })
    );
  });

  test('已下架的筆記不能被按讚（下架＝凍結，等 staff 恢復前不開放任何互動）', async () => {
    await seedNote('n1', { deleted: true });
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { likes: 1, likedBy: ['bob'] })
    );
  });

  test('作者本人可以編輯 preview（內容欄位）', async () => {
    await seedNote('n1');
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { preview: '<p>改過的內容</p>' })
    );
  });
});

// 這批測試涵蓋這輪修好的洞：作者分支原本沒有 affectedKeys() 限制，等於作者
// 可以改任意欄位——包含自行把 staff 剛下架的 deleted:true 改回 false（繞過
// 審核機制）、偽造 likes、把 uid/username 改成別人、繞過 create 當初的長度
// 限制。這裡逐一驗證這些操作現在全部會被拒絕，只有 pages/preview/image
// 仍然開放給作者編輯。
describe('sharedNotes update 規則（作者只能改內容欄位）', () => {
  const seedNote = async (noteId, overrides = {}) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sharedNotes/${noteId}`), {
        ...validSharedNote('alice'),
        ...overrides,
      });
    });
  };

  test('作者可以一次同時修改 pages、preview、image', async () => {
    await seedNote('n1');
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), {
        pages: [{ title: '改過的標題', content: '<p>改過的內容</p>' }],
        preview: '<p>改過的內容</p>',
        image: 'https://res.cloudinary.com/demo/image/upload/new.jpg',
      })
    );
  });

  test('作者不能把已下架的筆記自行恢復（這波修好的核心洞）', async () => {
    await seedNote('n1', { deleted: true });
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { deleted: false })
    );
  });

  test('作者不能透過一般 update 把 likes 改成任意數字', async () => {
    await seedNote('n1');
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { likes: 9999 })
    );
  });

  test('作者不能把筆記的 uid 改成別人（轉嫁歸屬）', async () => {
    await seedNote('n1');
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { uid: 'bob' })
    );
  });

  test('作者不能改 username', async () => {
    await seedNote('n1');
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { username: '換了一個名字' })
    );
  });

  test('作者不能改 createdAt', async () => {
    await seedNote('n1');
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc, serverTimestamp: freshTimestamp } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { createdAt: freshTimestamp() })
    );
  });

  test('作者把 pages 清空會被拒絕（繞過 create 當初的長度限制）', async () => {
    await seedNote('n1');
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { pages: [] })
    );
  });

  test('作者把 preview 改到超過長度上限會被拒絕', async () => {
    await seedNote('n1');
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { preview: 'x'.repeat(5001) })
    );
  });

  test('非作者不能修改 pages/preview/image（作者限定，不是任何登入者都能編輯）', async () => {
    await seedNote('n1');
    const bob = testEnv.authenticatedContext('bob');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'sharedNotes/n1'), { preview: '<p>不是我的筆記</p>' })
    );
  });

  test('已下架的筆記，作者也不能編輯內容（下架＝凍結，避免 staff 恢復時看到的'
    + '不是當初下架當下的那份內容，獨立審查覆核找到的問題）', async () => {
    await seedNote('n1', { deleted: true });
    const alice = testEnv.authenticatedContext('alice');
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'sharedNotes/n1'), { preview: '<p>趁下架時偷改</p>' })
    );
  });
});

describe('sharedNotes update 規則（staff 寫入 deleted 的型別）', () => {
  const seedNote = async (noteId, overrides = {}) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sharedNotes/${noteId}`), {
        ...validSharedNote('alice'),
        ...overrides,
      });
    });
  };

  test('staff 把 deleted 寫成字串會被拒絕（型別不對可能讓文件永久對外隱藏）', async () => {
    await seedNote('n1');
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(staffBob.firestore(), 'sharedNotes/n1'), { deleted: 'true' })
    );
  });

  test('staff 把 deleted 寫成 null 會被拒絕', async () => {
    await seedNote('n1');
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    const { updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(staffBob.firestore(), 'sharedNotes/n1'), { deleted: null })
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

describe('users/{uid}/quizRuleState 規則（規則熟練度狀態，只有後端能寫）', () => {
  const path = 'users/alice/quizRuleState/amis';
  const state = { skills: {}, confusions: {}, revision: 1, nonces: ['n1'] };
  let getDoc;
  let deleteDoc;

  beforeAll(async () => {
    ({ getDoc, deleteDoc } = await import('firebase/firestore'));
  });

  test('本人可以讀自己的狀態', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path), state);
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(getDoc(doc(alice.firestore(), path)));
  });

  test('別人不能讀', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path), state);
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(getDoc(doc(bob.firestore(), path)));
  });

  test('未登入不能讀', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(anon.firestore(), path)));
  });

  test('staff 也不能讀（這是個人學習資料，後台用不到）', async () => {
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    await assertFails(getDoc(doc(staffBob.firestore(), path)));
  });

  test('本人也不能寫（防止自己改熟練度或繞過 nonce 去重）', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), path), state));
  });

  test('本人也不能刪除', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), path), state);
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(deleteDoc(doc(alice.firestore(), path)));
  });

  test('staff 與別人都不能寫', async () => {
    const staffBob = testEnv.authenticatedContext('bob', { role: 'admin' });
    await assertFails(setDoc(doc(staffBob.firestore(), path), state));
  });

  test('users 主文件的規則不受影響：本人仍可寫自己的 users 文件', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(setDoc(doc(alice.firestore(), 'users/alice'), { name: 'Alice' }));
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

// storageUrl 原本完全沒有驗證，惡意使用者可以建立一筆帶偽造 storageUrl
// （指向同一個 bucket 裡任何其他物件）的錄音文件，誘使之後的審核下架／
// 帳號刪除流程刪掉不相關的檔案（見 backend/adminapi/firebase_ops.py 的
// delete_storage_file_by_download_url() 同一輪修正）。這裡直接測 create
// 規則本身，之前的測試都用 withSecurityRulesDisabled 繞過規則造測試資料，
// 從未真正驗證過這條 create 規則。
describe('pronunciations recordings create 規則', () => {
  const validRecordingUrl = (tribe, word = 'huzil', filename = '123_alice.webm') => (
    `https://firebasestorage.googleapis.com/v0/b/yuanyu-app.appspot.com/o/`
    + `pronunciations%2F${tribe}%2F${word}%2F${filename}?alt=media&token=abc`
  );

  const validRecording = (tribe, overrides = {}) => ({
    uid: 'alice',
    tribe,
    word: 'huzil',
    score: 88,
    storageUrl: validRecordingUrl(tribe),
    createdAt: serverTimestamp(),
    ...overrides,
  });

  test('本人建立形狀合法、storageUrl 落在對應族語底下時可以成功', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(
      setDoc(doc(alice.firestore(), 'pronunciations/tayal/recordings/r1'), validRecording('tayal'))
    );
  });

  test('uid 不是本人時被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(doc(alice.firestore(), 'pronunciations/tayal/recordings/r1'), validRecording('tayal', { uid: 'bob' }))
    );
  });

  test('storageUrl 指向別的族語資料夾時被拒絕（核心安全修正案例）', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(
        doc(alice.firestore(), 'pronunciations/tayal/recordings/r1'),
        validRecording('tayal', { storageUrl: validRecordingUrl('amis') })
      )
    );
  });

  test('storageUrl 指向完全不相干的物件（例如辭典媒體）時被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const unrelatedUrl = 'https://firebasestorage.googleapis.com/v0/b/yuanyu-app.appspot.com/o/'
      + 'dictionary_media%2Fimportant_word_audio.mp3?alt=media';
    await assertFails(
      setDoc(
        doc(alice.firestore(), 'pronunciations/tayal/recordings/r1'),
        validRecording('tayal', { storageUrl: unrelatedUrl })
      )
    );
  });

  test('文件內的 tribe 欄位跟路徑上的 tribe 不一致時被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(doc(alice.firestore(), 'pronunciations/tayal/recordings/r1'), validRecording('amis'))
    );
  });

  test('路徑上的族語不在白名單內時被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(
        doc(alice.firestore(), 'pronunciations/klingon/recordings/r1'),
        { ...validRecording('klingon'), storageUrl: validRecordingUrl('klingon') }
      )
    );
  });

  test('createdAt 不是伺服器時間戳記時被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(doc(alice.firestore(), 'pronunciations/tayal/recordings/r1'), validRecording('tayal', { createdAt: new Date() }))
    );
  });

  test('score 型別或範圍不合法時被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(doc(alice.firestore(), 'pronunciations/tayal/recordings/r1'), validRecording('tayal', { score: 150 }))
    );
    await assertFails(
      setDoc(doc(alice.firestore(), 'pronunciations/tayal/recordings/r2'), validRecording('tayal', { score: '88' }))
    );
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

// ---- 雲端筆記（D-1）：users/{uid}/notes ＋ users/{uid}/noteIndex/summary ----

const validCloudNote = (overrides = {}) => ({
  title: '我的筆記',
  content: '<p>內容</p>',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  editedAt: 1760000000000,
  ...overrides,
});

const indexData = (count, lastOp, lastId) => ({
  count,
  lastOp,
  lastId,
  updatedAt: serverTimestamp(),
});

// 新增一頁 = 筆記＋計數在同一個批次。count 是「新增之後」的頁數。
const createNoteBatch = (ctx, uid, noteId, count, noteOverrides = {}, indexOverrides = {}) => {
  const db = ctx.firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, `users/${uid}/notes/${noteId}`), validCloudNote(noteOverrides));
  batch.set(doc(db, `users/${uid}/noteIndex/summary`), { ...indexData(count, 'create', noteId), ...indexOverrides });
  return batch.commit();
};

const seedNote = async (uid, noteId, count) => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${uid}/notes/${noteId}`), {
      title: '舊筆記', content: '<p>x</p>', createdAt: new Date(), updatedAt: new Date(), editedAt: 1760000000000,
    });
    await setDoc(doc(db, `users/${uid}/noteIndex/summary`), {
      count, lastOp: 'create', lastId: noteId, updatedAt: new Date(),
    });
  });
};

describe('雲端筆記 users/{uid}/notes：隔離', () => {
  test('本人可以新增並讀回自己的筆記', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(createNoteBatch(alice, 'alice', 'note-1', 1));
    await assertSucceeds(getDoc(doc(alice.firestore(), 'users/alice/notes/note-1')));
  });

  test('別的帳號讀不到、也寫不進我的筆記', async () => {
    await seedNote('alice', 'note-1', 1);
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(getDoc(doc(bob.firestore(), 'users/alice/notes/note-1')));
    await assertFails(createNoteBatch(bob, 'alice', 'note-2', 2));
    await assertFails(updateDoc(doc(bob.firestore(), 'users/alice/notes/note-1'), { title: '改掉', updatedAt: serverTimestamp(), editedAt: 1760000000001 }));
  });

  test('後台人員也讀不到使用者的個人筆記', async () => {
    await seedNote('alice', 'note-1', 1);
    const staff = testEnv.authenticatedContext('staff1', { role: 'admin' });
    await assertFails(getDoc(doc(staff.firestore(), 'users/alice/notes/note-1')));
  });

  test('未登入不能讀寫', async () => {
    await seedNote('alice', 'note-1', 1);
    const anon = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(anon.firestore(), 'users/alice/notes/note-1')));
    await assertFails(createNoteBatch(anon, 'alice', 'note-2', 2));
  });
});

describe('雲端筆記 users/{uid}/notes：單頁限制與形狀', () => {
  test('標題剛好 100 字元可以，101 字元會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(createNoteBatch(alice, 'alice', 'n1', 1, { title: '字'.repeat(100) }));
    await assertFails(createNoteBatch(alice, 'alice', 'n2', 2, { title: '字'.repeat(101) }));
  });

  test('空標題可以（本機筆記允許沒有標題）', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(createNoteBatch(alice, 'alice', 'n1', 1, { title: '' }));
  });

  test('內容超過 100,000 字元會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(createNoteBatch(alice, 'alice', 'n1', 1, { content: 'a'.repeat(100000) }));
    await assertFails(createNoteBatch(alice, 'alice', 'n2', 2, { content: 'a'.repeat(100001) }));
  });

  test('夾帶多餘欄位、缺少欄位、型別不對都會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(createNoteBatch(alice, 'alice', 'n1', 1, { extra: 'x' }));
    const db = alice.firestore();
    const missing = writeBatch(db);
    const { editedAt: _omit, ...withoutEditedAt } = validCloudNote();
    missing.set(doc(db, 'users/alice/notes/n1'), withoutEditedAt);
    missing.set(doc(db, 'users/alice/noteIndex/summary'), indexData(1, 'create', 'n1'));
    await assertFails(missing.commit());
    await assertFails(createNoteBatch(alice, 'alice', 'n1', 1, { title: 123 }));
    await assertFails(createNoteBatch(alice, 'alice', 'n1', 1, { content: null }));
    await assertFails(createNoteBatch(alice, 'alice', 'n1', 1, { editedAt: '2026-10-14' }));
  });

  test('createdAt／updatedAt 必須是伺服器時間，不能由用戶端偽造', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(createNoteBatch(alice, 'alice', 'n1', 1, { createdAt: new Date('2020-01-01') }));
    await assertFails(createNoteBatch(alice, 'alice', 'n1', 1, { updatedAt: new Date('2020-01-01') }));
  });

  test('editedAt 不能設在遙遠的未來，一天內的時鐘誤差可以', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(createNoteBatch(alice, 'alice', 'n1', 1, { editedAt: Date.now() + 7 * 86400000 }));
    await assertFails(createNoteBatch(alice, 'alice', 'n1', 1, { editedAt: 0 }));
    await assertSucceeds(createNoteBatch(alice, 'alice', 'n1', 1, { editedAt: Date.now() + 3600000 }));
  });

  test('筆記 id 只能是英數、底線、連字號，長度 1 至 128', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(createNoteBatch(alice, 'alice', '3f2a9c1e-8b7d-4e6f-a1b2-c3d4e5f60718', 1));
    await assertFails(createNoteBatch(alice, 'alice', 'a'.repeat(129), 2));
    await assertFails(createNoteBatch(alice, 'alice', 'bad id!', 2));
  });
});

describe('雲端筆記 users/{uid}/notes：更新', () => {
  test('本人可以改標題與內容，並更新 editedAt', async () => {
    await seedNote('alice', 'n1', 1);
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(updateDoc(doc(alice.firestore(), 'users/alice/notes/n1'), {
      title: '新標題', content: '<p>新內容</p>', updatedAt: serverTimestamp(), editedAt: 1760000005000,
    }));
  });

  test('不能改 createdAt，也不能夾帶新欄位', async () => {
    await seedNote('alice', 'n1', 1);
    const alice = testEnv.authenticatedContext('alice');
    const ref = doc(alice.firestore(), 'users/alice/notes/n1');
    await assertFails(updateDoc(ref, { createdAt: new Date('2020-01-01'), updatedAt: serverTimestamp(), editedAt: 1760000005000 }));
    await assertFails(updateDoc(ref, { extra: 'x', updatedAt: serverTimestamp(), editedAt: 1760000005000 }));
  });

  test('更新後標題或內容超過上限會被拒絕', async () => {
    await seedNote('alice', 'n1', 1);
    const alice = testEnv.authenticatedContext('alice');
    const ref = doc(alice.firestore(), 'users/alice/notes/n1');
    await assertFails(updateDoc(ref, { title: '字'.repeat(101), updatedAt: serverTimestamp(), editedAt: 1760000005000 }));
    await assertFails(updateDoc(ref, { content: 'a'.repeat(100001), updatedAt: serverTimestamp(), editedAt: 1760000005000 }));
  });

  test('用用戶端時間當 updatedAt 會被拒絕', async () => {
    await seedNote('alice', 'n1', 1);
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(updateDoc(doc(alice.firestore(), 'users/alice/notes/n1'), {
      title: '新標題', updatedAt: new Date('2020-01-01'), editedAt: 1760000005000,
    }));
  });
});

describe('雲端筆記：頁數計數與每人 200 頁上限', () => {
  test('沒有同批更新計數就新增筆記會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'users/alice/notes/n1'), validCloudNote()));
  });

  test('計數必須剛好加 1（加 2 或不變都被拒絕）', async () => {
    await seedNote('alice', 'n1', 1);
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(createNoteBatch(alice, 'alice', 'n2', 3));
    await assertFails(createNoteBatch(alice, 'alice', 'n2', 1));
    await assertSucceeds(createNoteBatch(alice, 'alice', 'n2', 2));
  });

  test('一個批次新增兩頁、只加 1 會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const db = alice.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'users/alice/notes/a'), validCloudNote());
    batch.set(doc(db, 'users/alice/notes/b'), validCloudNote());
    batch.set(doc(db, 'users/alice/noteIndex/summary'), indexData(1, 'create', 'a'));
    await assertFails(batch.commit());
  });

  test('計數裡的 lastId 和實際新增的那一頁不同會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(createNoteBatch(alice, 'alice', 'n1', 1, {}, { lastId: 'other' }));
  });

  test('已有 200 頁時再新增第 201 頁會被拒絕', async () => {
    await seedNote('alice', 'n200', 200);
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(createNoteBatch(alice, 'alice', 'n201', 201));
  });

  test('刪掉一頁之後可以再新增，回到 200 頁', async () => {
    await seedNote('alice', 'n200', 200);
    const alice = testEnv.authenticatedContext('alice');
    const db = alice.firestore();
    const del = writeBatch(db);
    del.delete(doc(db, 'users/alice/notes/n200'));
    del.set(doc(db, 'users/alice/noteIndex/summary'), indexData(199, 'delete', 'n200'));
    await assertSucceeds(del.commit());
    await assertSucceeds(createNoteBatch(alice, 'alice', 'n201', 200));
  });

  test('刪除筆記必須同批把計數減 1', async () => {
    await seedNote('alice', 'n1', 1);
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(deleteDoc(doc(alice.firestore(), 'users/alice/notes/n1')));
    const db = alice.firestore();
    const ok = writeBatch(db);
    ok.delete(doc(db, 'users/alice/notes/n1'));
    ok.set(doc(db, 'users/alice/noteIndex/summary'), indexData(0, 'delete', 'n1'));
    await assertSucceeds(ok.commit());
  });

  test('只改計數、不真的新增或刪除筆記，會被拒絕（不能偷改計數騰出名額）', async () => {
    await seedNote('alice', 'n1', 200);
    const alice = testEnv.authenticatedContext('alice');
    const ref = doc(alice.firestore(), 'users/alice/noteIndex/summary');
    await assertFails(setDoc(ref, indexData(0, 'delete', 'n1')));
    await assertFails(setDoc(ref, indexData(199, 'delete', 'n1')));
    await assertFails(setDoc(ref, indexData(201, 'create', 'ghost')));
  });

  test('計數文件不能刪除，也不能夾帶其他欄位', async () => {
    await seedNote('alice', 'n1', 1);
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(deleteDoc(doc(alice.firestore(), 'users/alice/noteIndex/summary')));
    await assertFails(createNoteBatch(alice, 'alice', 'n2', 2, {}, { extra: 'x' }));
  });

  test('別人讀不到我的計數，也改不了', async () => {
    await seedNote('alice', 'n1', 1);
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(getDoc(doc(bob.firestore(), 'users/alice/noteIndex/summary')));
    await assertFails(setDoc(doc(bob.firestore(), 'users/alice/noteIndex/summary'), indexData(0, 'delete', 'n1')));
  });

  test('不在 summary 的其他計數文件一律拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'users/alice/noteIndex/other'), indexData(1, 'create', 'n1')));
  });
});
