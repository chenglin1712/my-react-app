import { beforeEach, describe, expect, test, vi } from 'vitest';

const setDocMock = vi.fn();
const docMock = vi.fn((_db, collectionName, id) => ({ path: `${collectionName}/${id}` }));

vi.mock('firebase/firestore', () => ({
    doc: (...args) => docMock(...args),
    setDoc: (...args) => setDocMock(...args),
    serverTimestamp: () => 'SERVER_TIME',
}));

vi.mock('../../../firebase', () => ({
    db: {},
    auth: { currentUser: { uid: 'alice' } },
}));

import { REPORT_ALREADY_OR_DENIED, submitReport } from './reportService';

describe('submitReport', () => {
    beforeEach(() => {
        setDocMock.mockReset();
        docMock.mockClear();
    });

    test('文件 ID 固定為 {reporterUid}_{targetId}，同一人對同一目標只會有一筆（稽核 RUL-5）', async () => {
        setDocMock.mockResolvedValue(undefined);

        await submitReport({ targetType: 'note', targetId: 'note123', reason: 'spam' });

        expect(docMock).toHaveBeenCalledWith({}, 'reports', 'alice_note123');
        expect(setDocMock).toHaveBeenCalledWith(
            { path: 'reports/alice_note123' },
            expect.objectContaining({
                targetType: 'note',
                targetId: 'note123',
                reporterUid: 'alice',
                status: 'pending',
                createdAt: 'SERVER_TIME',
            }),
        );
    });

    test('被規則拒絕（permission-denied，可能是重複檢舉）時丟出帶固定 code 的錯誤，不假裝成功', async () => {
        setDocMock.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));

        await expect(
            submitReport({ targetType: 'note', targetId: 'note123', reason: 'spam' }),
        ).rejects.toMatchObject({ code: REPORT_ALREADY_OR_DENIED });
    });

    test('其他錯誤照常往外丟', async () => {
        setDocMock.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));

        await expect(
            submitReport({ targetType: 'note', targetId: 'note123', reason: 'spam' }),
        ).rejects.toThrow('offline');
    });

    test('reason 為 other 卻沒有說明時在送出前就擋下', async () => {
        await expect(
            submitReport({ targetType: 'note', targetId: 'note123', reason: 'other', reasonText: '  ' }),
        ).rejects.toThrow('請填寫檢舉原因說明');
        expect(setDocMock).not.toHaveBeenCalled();
    });
});
