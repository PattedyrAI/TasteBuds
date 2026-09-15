import {HttpError} from './auth';

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_000) {
        await reader.cancel().catch(() => {});
        throw new HttpError('This request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks, size).toString('utf8');
  let value: unknown;
  try { value = text ? JSON.parse(text) : {}; }
  catch { throw new HttpError('Invalid request.', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError('Send a JSON object.', 400);
  return value as Record<string, unknown>;
}
