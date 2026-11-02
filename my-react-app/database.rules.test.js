// @vitest-environment node
//
// Realtime Database 規則的行為測試（database.rules.json）：status/{uid} 只有本人能讀寫，
// 且資料形狀固定為 { state: 'online' | 'offline', lastChanged: 數字 }（稽核 RUL-7）。
// 執行方式見 package.json 的 test:rules（搭配 emulators:exec）。
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';
import { readFileSync } from 'fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, set, get, remove, serverTimestamp } from 'firebase/database';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'yuanyu-app-database-rules-test',
    database: {
      rules: readFileSync('database.rules.json', 'utf8'),
      host: '127.0.0.1',
      port: 9000,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearDatabase();
});

const statusRef = (ctx, uid) => ref(ctx.database(), `status/${uid}`);

describe('status/{uid} 規則', () => {
  test('本人寫入 presence（跟 userServive.jsx 一樣用伺服器時間戳記）可以成功', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(set(statusRef(alice, 'alice'), { state: 'online', lastChanged: serverTimestamp() }));
    await assertSucceeds(set(statusRef(alice, 'alice'), { state: 'offline', lastChanged: serverTimestamp() }));
  });

  test('本人可以讀、可以刪除自己的節點', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(set(statusRef(alice, 'alice'), { state: 'online', lastChanged: 1 }));
    await assertSucceeds(get(statusRef(alice, 'alice')));
    await assertSucceeds(remove(statusRef(alice, 'alice')));
  });

  test('別人與未登入者不能讀寫', async () => {
    const bob = testEnv.authenticatedContext('bob');
    const anon = testEnv.unauthenticatedContext();
    await assertFails(set(statusRef(bob, 'alice'), { state: 'online', lastChanged: 1 }));
    await assertFails(get(statusRef(bob, 'alice')));
    await assertFails(set(statusRef(anon, 'alice'), { state: 'online', lastChanged: 1 }));
  });

  test('state 不是 online／offline 會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(set(statusRef(alice, 'alice'), { state: 'away', lastChanged: 1 }));
    await assertFails(set(statusRef(alice, 'alice'), { state: 1, lastChanged: 1 }));
  });

  test('lastChanged 不是數字會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(set(statusRef(alice, 'alice'), { state: 'online', lastChanged: 'now' }));
  });

  test('缺少必要欄位會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(set(statusRef(alice, 'alice'), { state: 'online' }));
  });

  test('夾帶多餘欄位或塞大型資料會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(set(statusRef(alice, 'alice'), { state: 'online', lastChanged: 1, junk: 'x'.repeat(10000) }));
    await assertFails(set(statusRef(alice, 'alice'), 'x'.repeat(10000)));
  });
});
