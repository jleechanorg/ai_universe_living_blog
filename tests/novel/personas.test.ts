import { describe, it, expect } from 'vitest';
import { getPersona, getVoiceInstructions, PERSONAS } from '../../src/novel/personas.js';

describe('Novel Persona Library', () => {
  describe('getPersona', () => {
    it('returns consistent persona for the same workerId', () => {
      const first = getPersona('ao-826');
      const second = getPersona('ao-826');
      expect(second).toBe(first);
    });

    it('returns consistent persona across many calls for the same workerId', () => {
      const results = Array.from({ length: 10 }, () => getPersona('jc-500'));
      const first = results[0];
      for (const r of results) {
        expect(r).toBe(first);
      }
    });

    it('returns different personas for different workerIds (mod distribution)', () => {
      // With 6 personas and hash % 6, at least some different workerIds should
      // land on different personas. Test a spread of IDs.
      const seen = new Set<string>();
      for (let i = 0; i < 30; i++) {
        seen.add(getPersona(`ao-${i}`).id);
      }
      // With 30 inputs across 6 buckets, we expect at least 3 distinct personas
      expect(seen.size).toBeGreaterThanOrEqual(3);
    });
  });

  describe('PERSONAS array', () => {
    it('exposes exactly 6 personas', () => {
      expect(PERSONAS).toHaveLength(6);
    });

    it('each persona has required fields', () => {
      for (const p of PERSONAS) {
        expect(typeof p.id).toBe('string');
        expect(p.id.length).toBeGreaterThan(0);
        expect(typeof p.name).toBe('string');
        expect(p.name.length).toBeGreaterThan(0);
        expect(typeof p.role).toBe('string');
        expect(p.role.length).toBeGreaterThan(0);
        expect(Array.isArray(p.voiceSamples)).toBe(true);
        expect(p.voiceSamples.length).toBeGreaterThan(0);
        expect(Array.isArray(p.speechPatterns)).toBe(true);
        expect(p.speechPatterns.length).toBeGreaterThan(0);
        expect(typeof p.emotionalBaseline).toBe('string');
        expect(p.emotionalBaseline.length).toBeGreaterThan(0);
        expect(typeof p.systemPromptSnippet).toBe('string');
        expect(p.systemPromptSnippet.length).toBeGreaterThan(0);
      }
    });

    it('all 6 personas are reachable via getPersona', () => {
      // Probe workerIds that should cover all 6 buckets: ao-0 through ao-5
      const reached = new Set<string>();
      for (let i = 0; i < 6; i++) {
        reached.add(getPersona(`ao-${i}`).id);
      }
      expect(reached.size).toBe(6);
    });

    it('persona IDs are unique', () => {
      const ids = PERSONAS.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('getVoiceInstructions', () => {
    it('returns a non-empty string for each persona', () => {
      for (const p of PERSONAS) {
        const instructions = getVoiceInstructions(p);
        expect(typeof instructions).toBe('string');
        expect(instructions.length).toBeGreaterThan(0);
      }
    });

    it('includes the persona name in the instructions', () => {
      for (const p of PERSONAS) {
        const instructions = getVoiceInstructions(p);
        expect(instructions).toContain(p.name);
      }
    });

    it('includes the emotional baseline in the instructions', () => {
      for (const p of PERSONAS) {
        const instructions = getVoiceInstructions(p);
        expect(instructions).toContain(p.emotionalBaseline);
      }
    });

    it('includes at least one voice sample in the instructions', () => {
      for (const p of PERSONAS) {
        const instructions = getVoiceInstructions(p);
        expect(instructions).toContain(p.voiceSamples[0]);
      }
    });

    it('returns different strings for different personas', () => {
      const instructions = PERSONAS.map((p) => getVoiceInstructions(p));
      const unique = new Set(instructions);
      expect(unique.size).toBe(PERSONAS.length);
    });
  });

  describe('hash-based distribution', () => {
    it('workerIds that differ only in prefix get different personas sometimes', () => {
      // ao-0 through ao-11 should cover all 6 personas with some collisions
      const seen = new Set<string>();
      for (let i = 0; i < 12; i++) {
        seen.add(getPersona(`ao-${i}`).id);
      }
      // 12 inputs over 6 buckets — should see at least 5 distinct personas
      expect(seen.size).toBeGreaterThanOrEqual(5);
    });

    it('non-numeric workerId uses fallback hash of 0', () => {
      // "abc" has no digits → numericPart = "0" → 0 % 6 = 0
      const persona = getPersona('abc');
      expect(persona).toBe(PERSONAS[0]);
    });

    it('handles workerIds with only digits gracefully', () => {
      // "42" → slice(-2) = "42" → 42 % 6 = 0
      const persona = getPersona('42');
      expect(persona).toBeDefined();
    });
  });
});
