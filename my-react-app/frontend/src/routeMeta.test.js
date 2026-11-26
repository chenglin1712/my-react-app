import { describe, expect, test } from 'vitest';
import { getPageTitle } from './routeMeta';

describe('前台分頁標題', () => {
    test('各主要頁面有自己的標題', () => {
        expect(getPageTitle('/search')).toBe('單詞查詢｜原語');
        expect(getPageTitle('/translate')).toBe('翻譯｜原語');
        expect(getPageTitle('/login')).toBe('登入｜原語');
        expect(getPageTitle('/note/share')).toBe('筆記分享區｜原語');
    });

    test('子路徑沿用所屬功能的標題，精確路徑優先於前綴', () => {
        expect(getPageTitle('/game/vocabulary/tayal')).toBe('遊戲專區｜原語');
        expect(getPageTitle('/quiz/select')).toBe('選擇測驗族語｜原語');
        expect(getPageTitle('/quiz/amis/1')).toBe('測驗｜原語');
        expect(getPageTitle('/note')).toBe('寫筆記｜原語');
    });

    test('首頁保留品牌名稱', () => {
        expect(getPageTitle('/')).toBe('原語｜五族語言學習平台');
    });

    test('不存在的網址標示為找不到頁面', () => {
        expect(getPageTitle('/no-such-page')).toBe('找不到頁面｜原語');
    });

  test('稽核 FE1-21：標題與頁面 h1、導覽名稱一致', () => {
    expect(getPageTitle('/reset')).toBe('變更密碼｜原語');
    expect(getPageTitle('/favorite')).toBe('個人詞語庫｜原語');
    expect(getPageTitle('/edit')).toBe('編輯個人資料｜原語');
  });

  test('頁尾三個入口頁有自己的標題', () => {
    expect(getPageTitle('/help')).toBe('使用說明｜原語');
    expect(getPageTitle('/privacy')).toBe('隱私與資料｜原語');
    expect(getPageTitle('/announcements')).toBe('最新公告｜原語');
    expect(getPageTitle('/topics/12')).toBe('本期專題｜原語');
    expect(getPageTitle('/contact')).toBe('聯絡我們｜原語');
  });
});
