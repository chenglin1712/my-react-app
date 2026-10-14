import { describe, test, expect } from 'vitest';
import { FALLBACK_ALPHABET, deriveInitialLetters, resolveAlphabet, sortLetters } from './wordLetters';

const word = (name, hasExplanation = true) => ({ name, explanationItems: hasExplanation ? [{}] : [] });

describe('wordLetters', () => {
  test('sortLetters：字母依序、撇號類排最後、去重', () => {
    expect(sortLetters(['z', "'", 'a', 'a', 'd'])).toEqual(['a', 'd', 'z', "'"]);
  });

  test('deriveInitialLetters：只算有釋義的詞，轉小寫，符號開頭（詞綴）不收，保留撇號', () => {
    const letters = deriveInitialLetters([
      word('Balay'), word('balan'), word('dahu'), word("'abc"), word('-suffix'), word('xyz', false),
    ]);
    expect(letters).toEqual(['b', 'd', "'"]);
  });

  test('deriveInitialLetters：沒有資料回傳空陣列', () => {
    expect(deriveInitialLetters([])).toEqual([]);
    expect(deriveInitialLetters(undefined)).toEqual([]);
  });

  test('resolveAlphabet：有後端清單就用它（含 d、f、j、v），沒有就用保底且不排除任何字母', () => {
    expect(resolveAlphabet(['f', 'a', 'd'])).toEqual(['a', 'd', 'f']);
    expect(resolveAlphabet(undefined)).toBe(FALLBACK_ALPHABET);
    // 後端明確說「沒有可列的字母」就保持空的
    expect(resolveAlphabet([])).toEqual([]);
    ['d', 'f', 'j', 'v'].forEach((l) => expect(FALLBACK_ALPHABET).toContain(l));
  });
});
