import {describe, expect, it} from 'vitest';
import {readJsonBody} from '../src/server/request-body';

function request(body?: string | ReadableStream<Uint8Array>) {
  return new Request('https://example.test/api/groups', {
    method: 'POST', body, duplex: 'half',
  } as RequestInit & {duplex: 'half'});
}

describe('bounded JSON request bodies', () => {
  it('cancels an oversized chunked stream before buffering the rest', async () => {
    let pulled = 0, cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++pulled === 100) controller.close();
        else controller.enqueue(new Uint8Array(16_000).fill(32));
      },
      cancel() { cancelled = true; },
    });
    await expect(readJsonBody(request(stream))).rejects.toMatchObject({status: 413});
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(4);
  });

  it('counts UTF-8 bytes rather than JavaScript characters', async () => {
    const body = JSON.stringify({body: 'ø'.repeat(16_000)});
    expect(body.length).toBeLessThan(32_000);
    await expect(readJsonBody(request(body))).rejects.toMatchObject({status: 413});
  });

  it('accepts a JSON object exactly at the byte limit', async () => {
    const value = {body: 'x'.repeat(32_000 - 11)};
    expect(new TextEncoder().encode(JSON.stringify(value))).toHaveLength(32_000);
    await expect(readJsonBody(request(JSON.stringify(value)))).resolves.toEqual(value);
  });

  it('decodes UTF-8 characters split across stream chunks', async () => {
    const value = {name: 'Blåbær'}, bytes = new TextEncoder().encode(JSON.stringify(value));
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({pull(controller) {
      if (offset === bytes.length) controller.close();
      else controller.enqueue(bytes.slice(offset, ++offset));
    }});
    await expect(readJsonBody(request(stream))).resolves.toEqual(value);
  });

  it.each(['null', '[]', '42', 'true', '"text"', '{invalid'])('rejects non-object or malformed JSON: %s', async body => {
    await expect(readJsonBody(request(body))).rejects.toMatchObject({status: 400});
  });

  it('keeps empty action requests valid', async () => {
    await expect(readJsonBody(request())).resolves.toEqual({});
  });
});
