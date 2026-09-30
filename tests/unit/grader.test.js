import { describe, test, expect } from 'vitest';
import { RESULTS_FORMAT, parseResults } from '../../api/_lib/grader.js';
import { completion } from './fixtures.js';

describe('parseResults', () => {
  test('keeps well-formed results for ids in the batch', () => {
    const data = completion({ results: [{ id: 7, feedback: 'Good', score: 92 }] });
    expect(parseResults(data, [7])).toEqual([{ id: 7, feedback: 'Good', score: 92 }]);
  });

  test('drops malformed results and ids outside the batch', () => {
    const data = completion({
      results: [
        { id: '1', feedback: 'OK', score: 80 },
        { id: 2, feedback: 'No score' },
        { id: 99, feedback: 'Not in batch', score: 50 },
      ],
    });
    expect(parseResults(data, [1, 2])).toEqual([{ id: 1, feedback: 'OK', score: 80 }]);
  });

  test('tolerates a bare array', () => {
    const data = { choices: [{ message: { content: JSON.stringify([{ id: 3, feedback: 'x', score: 1 }]) } }] };
    expect(parseResults(data, [3])).toHaveLength(1);
  });

  test('rejects a response without message content', () => {
    expect(() => parseResults({ results: [] }, [1])).toThrow();
  });
});

describe('RESULTS_FORMAT', () => {
  test('asks for strict json_schema output with a results array', () => {
    expect(RESULTS_FORMAT.type).toBe('json_schema');
    expect(RESULTS_FORMAT.json_schema.strict).toBe(true);
    expect(RESULTS_FORMAT.json_schema.schema.required).toEqual(['results']);
  });
});
