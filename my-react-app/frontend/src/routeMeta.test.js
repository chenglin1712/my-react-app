import { describe, expect, test } from 'vitest';
import { getPageTitle } from './routeMeta';

describe('前台分頁標題', () => {
    test('各主要頁面有自己的標題', () => {
        expect(getPageTitle('/search')).toBe('單詞查詢｜源·語');
        expect(getPageTitle('/translate')).toBe('翻譯｜源·語');
        expect(getPageTitle('/login')).toBe('登入｜源·語');
        expect(getPageTitle('/note/share')).toBe('筆記分享區｜源·語');
    });

    test('子路徑沿用所屬功能的標題，精確路徑優先於前綴', () => {
        expect(getPageTitle('/game/vocabulary/tayal')).toBe('遊戲專區｜源·語');
        expect(getPageTitle('/quiz/select')).toBe('選擇測驗族語｜源·語');
        expect(getPageTitle('/quiz/amis/1')).toBe('測驗｜源·語');
        expect(getPageTitle('/note')).toBe('寫筆記｜源·語');
    });

    test('首頁保留品牌名稱', () => {
        expect(getPageTitle('/')).toBe('源·語｜五族語言學習平台');
    });

    test('不存在的網址標示為找不到頁面', () => {
        expect(getPageTitle('/no-such-page')).toBe('找不到頁面｜源·語');
    });
});
