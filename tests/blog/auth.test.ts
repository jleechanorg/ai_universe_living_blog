import { describe, it, expect } from 'vitest';
import { hashKey, verifyKey } from '../../src/blog/auth.js';

describe('auth — hashKey', () => {
  it('produces consistent 64-char hex output', () => {
    const h = hashKey('test-key-abc123');
    expect(h).toHaveLength(64);
    expect(h).toBe(hashKey('test-key-abc123'));
  });

  it('differs for different inputs', () => {
    expect(hashKey('key1')).not.toBe(hashKey('key2'));
  });

  it('is deterministic', () => {
    const key = 'my-deterministic-key';
    expect(hashKey(key)).toBe(hashKey(key));
  });
});

describe('auth — verifyKey', () => {
  it('returns true for matching key', () => {
    const plain = 'my-secret-key';
    const stored = hashKey(plain);
    expect(verifyKey(plain, stored)).toBe(true);
  });

  it('returns false for wrong key', () => {
    const stored = hashKey('correct-key');
    expect(verifyKey('wrong-key', stored)).toBe(false);
  });

  it('returns false for empty string', () => {
    const stored = hashKey('nonempty');
    expect(verifyKey('', stored)).toBe(false);
  });
});
