import {HttpError} from './auth';

/** Read the body as text, refusing more than `limit` bytes without buffering the rest. */
export async function readBodyText(request: Request, limit = 32_000): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw new HttpError('This request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size).toString('utf8');
}
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await readBodyText(request);
  let value: unknown;
  try { value = text ? JSON.parse(text) : {}; }
  catch { throw new HttpError('Invalid request.', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError('Send a JSON object.', 400);
  return value as Record<string, unknown>;
}
