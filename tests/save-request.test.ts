import {describe, expect, it} from 'vitest';
import {requestToSend} from '../src/components/save-request';

describe('create request retries', () => {
  it('resends the exact first body for an unchanged form, even if a rebuild would differ', () => {
    const first = requestToSend(null, 'form-A', () => ({tastedAt: '2026-11-16T10:00:00.000Z', itemId: 'confirmed-item', idempotencyKey: 'k'}));
    const retry = requestToSend(first, 'form-A', () => ({tastedAt: '2026-11-16T10:00:07.000Z', itemId: undefined, idempotencyKey: 'k'}));
    expect(retry.body).toBe(first.body);
    expect(retry.body).toEqual({tastedAt: '2026-11-16T10:00:00.000Z', itemId: 'confirmed-item', idempotencyKey: 'k'});
  });
  it('builds a new body once the form changed', () => {
    const first = requestToSend(null, 'form-A', () => ({score: 7}));
    expect(requestToSend(first, 'form-B', () => ({score: 8})).body).toEqual({score: 8});
  });
});
