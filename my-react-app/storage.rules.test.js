// @vitest-environment node
//
// Storage 規則的行為測試（storage.rules）：只允許登入者在
// pronunciations/{tribe}/{word}/{uuid}_{uid}.webm 建立 10 MB 以內的 audio/webm，
// 其餘一律拒絕。執行方式見 package.json 的 test:rules（搭配 emulators:exec）。
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';
import { readFileSync } from 'fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, deleteObject, getBytes } from 'firebase/storage';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'yuanyu-app-storage-rules-test',
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

const audio = (bytes = 1024) => new Uint8Array(bytes);
const webm = { contentType: 'audio/webm' };
const path = (tribe, uid, name = 'abc') => `pronunciations/${tribe}/lokah/${name}_${uid}.webm`;

describe('pronunciations 錄音上傳規則', () => {
  test('登入者上傳自己的 webm 錄音可以成功', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertSucceeds(uploadBytes(ref(alice, path('tayal', 'alice')), audio(), webm));
  });

  test('未登入不能上傳', async () => {
    const anon = testEnv.unauthenticatedContext().storage();
    await assertFails(uploadBytes(ref(anon, path('tayal', 'alice')), audio(), webm));
  });

  test('檔名帶的是別人的 uid 會被拒絕', async () => {
    const mallory = testEnv.authenticatedContext('mallory').storage();
    await assertFails(uploadBytes(ref(mallory, path('tayal', 'alice')), audio(), webm));
  });

  test('未知族語路徑會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertFails(uploadBytes(ref(alice, path('klingon', 'alice')), audio(), webm));
  });

  test('非 audio/webm 的內容型別會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertFails(uploadBytes(ref(alice, path('tayal', 'alice')), audio(), { contentType: 'text/html' }));
  });

  test('超過 10 MB 會被拒絕', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertFails(uploadBytes(ref(alice, path('tayal', 'alice')), audio(10 * 1024 * 1024 + 1), webm));
  });

  test('不能寫入 pronunciations 以外的路徑', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertFails(uploadBytes(ref(alice, 'anything/else.webm'), audio(), webm));
  });

  test('已存在的錄音不能被覆寫或刪除（刪除只由後端 Admin SDK 執行）', async () => {
    const p = path('tayal', 'alice');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), p), audio(), webm);
    });
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertFails(uploadBytes(ref(alice, p), audio(), webm));
    await assertFails(deleteObject(ref(alice, p)));
  });

  test('登入者可讀、未登入不能讀', async () => {
    const p = path('tayal', 'alice');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), p), audio(), webm);
    });
    await assertSucceeds(getBytes(ref(testEnv.authenticatedContext('bob').storage(), p)));
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), p)));
  });
});
