/**
 * Structured-output request. `json_schema` is accepted by OpenAI and by
 * Anthropic's OpenAI-compatible endpoint, and returns bare JSON in this
 * shape. Anthropic rejects the older `json_object` mode with a 400, and
 * with no format at all it wraps the JSON in a code fence.
 */
export const RESULTS_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'grading_results',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'feedback', 'score'],
            properties: {
              id: { type: 'integer' },
              feedback: { type: 'string' },
              score: { type: 'number' },
            },
          },
        },
      },
    },
  },
};

/**
 * Pulls the grading array out of an OpenAI-style chat completion.
 * Only well-formed results for ids in this batch are kept.
 */
export function parseResults(data, batchIds) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('LLM response has no choices[0].message.content');
  }

  // The schema asks for { results: [...] }; a bare array or a `grades` key is still tolerated
  const parsed = JSON.parse(content);
  const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.grades);
  if (!Array.isArray(results)) {
    throw new Error('LLM response content is not an array of results');
  }

  return results
    .map(r => ({ id: Number(r?.id), feedback: r?.feedback, score: r?.score }))
    .filter(r => batchIds.includes(r.id)
      && typeof r.feedback === 'string'
      && typeof r.score === 'number');
}
