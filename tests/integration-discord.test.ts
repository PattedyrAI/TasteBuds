import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {connectDiscord, processDiscordOutbox} from '../src/server/discord';
import {createGroup, createRating, deleteRating, ensureUser} from '../src/server/service';
import {getPool} from '../src/server/db';

const url = process.env.TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) || !new URL(url).pathname.endsWith('_test'))) throw new Error('Discord integration tests require a disposable local _test database');
if (url) process.env.DATABASE_URL = url;
const oldWebhook = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz';
const newWebhook = 'https://discord.com/api/webhooks/223456789012345678/abcdefghijklmnopqrstuvwxyz';
const ownerId = randomUUID();
let groupId: string;
let ratingIds: string[];

describe.skipIf(!url)('Discord delivery cancellation and current destination', () => {
  beforeAll(async () => {
    vi.stubEnv('DISCORD_ENCRYPTION_KEY', 'ab'.repeat(32));
    vi.stubEnv('APP_URL', 'https://example.test');
    await ensureUser({id: ownerId, displayName: 'Discord delivery test'});
  });
  beforeEach(async () => {
    // Every HTTP request is intercepted; these tests never contact Discord.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected HTTP request'); }));
    groupId = (await createGroup(ownerId, {name: 'Discord test '+randomUUID()})).id;
    await connectDiscord(ownerId, groupId, {url: oldWebhook, enabled: true});
    const photo = await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/png',1,1) RETURNING id", [groupId, ownerId, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64'), 'a'.repeat(64)]);
    ratingIds = [];
    for (let n = 0; n < 3; n++) {
      const rating = await createRating(ownerId, {groupId, name: 'Queued '+n, score: 7, photoId: photo.rows[0].id, idempotencyKey: randomUUID()});
      ratingIds.push(rating.id);
      // Put this test's three entries before other suites' pending work, in order.
      await getPool().query('UPDATE everrate.discord_outbox SET created_at=$1 WHERE rating_id=$2', ['0001-01-01T00:00:0'+n+'Z', rating.id]);
    }
  });
  afterEach(async () => {
    await connectDiscord(ownerId, groupId, {enabled: false});
    vi.unstubAllGlobals();
  });
  afterAll(async () => { vi.unstubAllEnvs(); await getPool().end(); });

  it('skips later claimed entries after an owner disables the connection', async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) await connectDiscord(ownerId, groupId, {enabled: false});
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    await processDiscordOutbox();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rows = await getPool().query('SELECT status FROM everrate.discord_outbox WHERE group_id=$1', [groupId]);
    expect(rows.rows.map(row => row.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });

  it('uses the new webhook for later claimed entries after rotation', async () => {
    const destinations: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      destinations.push(String(input));
      if (destinations.length === 1) await connectDiscord(ownerId, groupId, {url: newWebhook, enabled: true});
      return Response.json({});
    }));
    await processDiscordOutbox();
    expect(destinations).toEqual([oldWebhook+'?wait=true&with_components=true', newWebhook+'?wait=true&with_components=true', newWebhook+'?wait=true&with_components=true']);
  });

  it('skips a later claimed rating deleted during the first delivery', async () => {
    const titles: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      titles.push(JSON.parse(String(init?.body instanceof FormData?init.body.get('payload_json'):init?.body)).embeds[0].title);
      if (titles.length === 1) await deleteRating(ownerId, ratingIds[1]);
      return Response.json({});
    }));
    await processDiscordOutbox();
    expect(titles).toEqual(['Queued 0', 'Queued 2']);
    expect((await getPool().query('SELECT status FROM everrate.discord_outbox WHERE rating_id=$1', [ratingIds[1]])).rows[0].status).toBe('cancelled');
  });

  it('preserves bounded retry behavior for Discord rate limits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {status: 429, headers: {'retry-after': '120'}})));
    await processDiscordOutbox();
    const rows = await getPool().query('SELECT status,attempts,extract(epoch FROM (next_attempt_at-now()))::float seconds FROM everrate.discord_outbox WHERE group_id=$1', [groupId]);
    for (const row of rows.rows) {
      expect(row).toMatchObject({status: 'pending', attempts: 1});
      expect(row.seconds).toBeGreaterThan(115);
      expect(row.seconds).toBeLessThanOrEqual(120);
    }
  });

  it('does not overwrite a newer claim when an old HTTP request completes', async () => {
    let posts = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (++posts === 1) {
        // Simulate a replacement worker recovering this entry after its lease expires.
        await getPool().query('UPDATE everrate.discord_outbox SET attempts=attempts+1,locked_at=now() WHERE rating_id=$1', [ratingIds[0]]);
      }
      return Response.json({});
    }));
    await processDiscordOutbox();
    expect((await getPool().query('SELECT status,attempts FROM everrate.discord_outbox WHERE rating_id=$1', [ratingIds[0]])).rows[0]).toMatchObject({status: 'processing', attempts: 2});
  });
});
