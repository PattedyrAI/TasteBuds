/** One structured-JSON Gemini request. Errors carry fixed codes only; provider bodies are never surfaced. */
export async function generateJson(parts: unknown[], schema: object, {maxOutputTokens, timeoutMs = 30_000}: {maxOutputTokens: number; timeoutMs?: number}) {
  if (!process.env.GEMINI_API_KEY) throw new Error('not_configured');
  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  if (!/^gemini-[a-z0-9.-]+$/.test(model)) throw new Error('invalid_model');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: {'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY}, signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({contents: [{role: 'user', parts}], generationConfig: {responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0, maxOutputTokens, thinkingConfig: {thinkingLevel: 'minimal'}}}),
  });
  if (!response.ok) throw new Error(`provider_${response.status}`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.filter((p: {text?: string; thought?: boolean}) => p.text && !p.thought).map((p: {text: string}) => p.text).join('');
  if (!text) throw new Error('unrecognised');
  return {
    value: JSON.parse(text) as unknown, model,
    inputTokens: (payload.usageMetadata?.promptTokenCount ?? null) as number | null,
    outputTokens: ((payload.usageMetadata?.candidatesTokenCount ?? 0) + (payload.usageMetadata?.thoughtsTokenCount ?? 0)) as number,
  };
}
