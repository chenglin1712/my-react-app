import { beforeEach, describe, expect, test } from 'vitest';
import {
  RETENTION_MS, STORAGE_PREFIX, clearConversation, hasConversation, loadConversation, sanitizeMessages, saveConversation,
} from './botStorage';

const chat = [
  { id: 1, role: 'bot', text: '你好', greetingFor: 'tayal' },
  { id: 2, role: 'user', text: '問題', imageUrl: 'blob:abc' },
  { id: 3, role: 'bot', text: '答', sig: 'a'.repeat(64) },
  { id: 4, role: 'bot', text: '失敗', isError: true },
  { id: 5, role: 'bot', text: '半截', interrupted: 'failed' },
  { id: 6, role: 'bot', text: '串流中', streaming: true },
];

describe('botStorage', () => {
  beforeEach(() => localStorage.clear());

  test('saves only displayable messages and never an image preview url', () => {
    saveConversation('u1', { tribe: 'tayal', messages: chat });
    const loaded = loadConversation('u1');
    expect(loaded.messages.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(loaded.messages[1]).toMatchObject({ hadImage: true });
    expect(loaded.messages[1].imageUrl).toBeUndefined();
    expect(localStorage.getItem(`${STORAGE_PREFIX}u1`)).not.toContain('blob:');
  });

  test('conversations are separated per user', () => {
    saveConversation('u1', { tribe: 'tayal', messages: chat });
    expect(loadConversation('u2')).toBeNull();
  });

  test('a conversation with only the greeting is not kept', () => {
    saveConversation('u1', { tribe: 'tayal', messages: chat });
    saveConversation('u1', { tribe: 'tayal', messages: [chat[0]] });
    expect(loadConversation('u1')).toBeNull();
    expect(hasConversation([chat[0]])).toBe(false);
  });

  test('expires after seven days and removes the stale copy', () => {
    const now = 1_000_000_000_000;
    saveConversation('u1', { tribe: 'tayal', messages: chat }, now);
    expect(loadConversation('u1', now + RETENTION_MS - 1)).not.toBeNull();
    expect(loadConversation('u1', now + RETENTION_MS + 1)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_PREFIX}u1`)).toBeNull();
  });

  test('clear really removes it, and corrupt data is dropped', () => {
    saveConversation('u1', { tribe: 'tayal', messages: chat });
    clearConversation('u1');
    expect(loadConversation('u1')).toBeNull();
    localStorage.setItem(`${STORAGE_PREFIX}u1`, '{oops');
    expect(loadConversation('u1')).toBeNull();
    expect(localStorage.getItem(`${STORAGE_PREFIX}u1`)).toBeNull();
  });

  test('caps the number of saved messages', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: i, role: i % 2 ? 'bot' : 'user', text: `m${i}` }));
    expect(sanitizeMessages(many)).toHaveLength(40);
  });

  test('a trailing question that never got an answer is not saved or restored', () => {
    const orphan = [...chat.slice(0, 3), { id: 9, role: 'user', text: '被停止的問題' }];
    saveConversation('u1', { tribe: 'tayal', messages: orphan });
    expect(loadConversation('u1').messages.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  test('loading sweeps expired conversations of other accounts too', () => {
    const now = 1_000_000_000_000;
    saveConversation('old', { tribe: 'tayal', messages: chat }, now - RETENTION_MS - 10);
    saveConversation('u1', { tribe: 'tayal', messages: chat }, now);
    loadConversation('u1', now);
    expect(localStorage.getItem(`${STORAGE_PREFIX}old`)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_PREFIX}u1`)).not.toBeNull();
  });

  test('does nothing without a uid', () => {
    saveConversation(null, { tribe: 'tayal', messages: chat });
    expect(localStorage.length).toBe(0);
  });
});
