import { pathToFileURL } from 'node:url';

type Check = { name: string; status: 'pass' | 'fail'; detail: string };
type Manifest = { name?: string; start_url?: string; scope?: string; display?: string; icons?: { src: string; sizes?: string; type?: string }[] };
export type LaunchOptions = { baseUrl: string; authOrigin: string; expectedRelease?: string; allowLocal?: boolean };

function insist(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function localHost(hostname: string) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}
function safeOrigin(value: string, allowLocal: boolean) {
  const url = new URL(value);
  insist(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Use an origin without credentials, path, query or fragment.');
  insist(url.protocol === 'https:' || (allowLocal && url.protocol === 'http:' && localHost(url.hostname)), 'HTTPS is required; --allow-local permits loopback HTTP only.');
  return url.origin;
}
async function body(response: Response, maxBytes = 2_000_000) {
  insist(response.body, 'Response body is missing.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('Response exceeded the verification size limit.'); }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks);
}
async function json(response: Response) {
  insist(response.headers.get('content-type')?.includes('json'), 'Expected a JSON response.');
  try { return JSON.parse((await body(response)).toString('utf8')) as Record<string, unknown>; }
  catch { throw new Error('Response was not valid bounded JSON.'); }
}

/** Public, unauthenticated checks only. Never prints response bodies, cookies or OAuth URLs. */
export async function verifyLaunch(options: LaunchOptions, fetcher: typeof fetch = fetch) {
  const origin = safeOrigin(options.baseUrl, Boolean(options.allowLocal));
  const authOrigin = safeOrigin(options.authOrigin, Boolean(options.allowLocal));
  const checks: Check[] = [];
  let release: string | null = null;
  let manifest: Manifest | undefined;
  async function request(path: string, init: RequestInit = {}) {
    const url = new URL(path, origin);
    insist(url.origin === origin, 'Asset URL must remain on the application origin.');
    try { return await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'TasteBuds-launch-verifier/1.0', ...init.headers } }); }
    catch { throw new Error('Request failed or timed out.'); }
  }
  async function check(name: string, operation: () => Promise<string>) {
    try { checks.push({ name, status: 'pass', detail: await operation() }); }
    catch (error) { checks.push({ name, status: 'fail', detail: error instanceof Error ? error.message : 'Check failed.' }); }
  }

  await Promise.all([
    check('public-page', async () => {
      const response = await request('/');
      insist(response.status === 200 && response.headers.get('content-type')?.includes('text/html'), 'Landing page must return HTML with status 200.');
      const html = (await body(response)).toString('utf8');
      insist(html.includes('TasteBuds') && html.includes('/auth/login'), 'Landing page lacks the app name or Discord sign-in entry.');
      insist(/rel=["']manifest["']/.test(html), 'Landing page lacks a manifest link.');
      return origin.startsWith('https:') ? 'HTTPS landing page and sign-in entry respond.' : 'Loopback HTTP smoke check only.';
    }),
    check('database-health', async () => {
      const response = await request('/api/health');
      insist(response.status === 200, 'Database health endpoint did not return 200.');
      const data = await json(response);
      insist(data.status === 'ok' && data.app === 'TasteBuds', 'Health response did not identify a healthy TasteBuds app.');
      insist(response.headers.get('cache-control')?.includes('no-store'), 'Health response must not be cached.');
      release = typeof data.version === 'string' && /^[A-Za-z0-9._+-]{1,128}$/.test(data.version) ? data.version : null;
      if (options.expectedRelease) insist(release === options.expectedRelease, 'Release marker differs from EXPECTED_RELEASE.');
      return options.expectedRelease ? 'Database responds; expected release marker matches.' : 'Database responds; release marker is reported but not independently matched.';
    }),
    check('manifest', async () => {
      const response = await request('/manifest.webmanifest');
      insist(response.status === 200, 'Web app manifest did not return 200.');
      const candidate = await json(response) as Manifest;
      insist(candidate.name === 'TasteBuds' && candidate.display === 'standalone', 'Manifest must name TasteBuds and request standalone display.');
      insist(typeof candidate.start_url === 'string' && new URL(candidate.start_url, origin).origin === origin, 'Manifest start URL must remain on the app origin.');
      insist(candidate.scope === '/', 'Manifest scope must cover the app.');
      insist(Array.isArray(candidate.icons) && ['192x192', '512x512'].every(size => candidate.icons!.some(icon => icon.sizes === size && icon.type === 'image/png')), 'Manifest must include 192px and 512px PNG icons.');
      manifest = candidate;
      return 'Standalone manifest includes launch URL and both PNG icon sizes.';
    }),
    check('unauthenticated-read', async () => {
      const response = await request('/api/bootstrap');
      insist(response.status === 401, 'Unauthenticated bootstrap must return 401.');
      insist(typeof (await json(response)).error === 'string', 'Unauthorized response must use the JSON error contract.');
      return 'Private bootstrap denies a request without a session.';
    }),
    check('unauthenticated-write', async () => {
      const response = await request('/api/ratings', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
      insist(response.status === 401, 'Same-origin rating submission without a session must return 401.');
      insist(typeof (await json(response)).error === 'string', 'Unauthorized write must use the JSON error contract.');
      return 'Rating endpoint denies a same-origin request without a session.';
    }),
    check('cross-origin-write', async () => {
      const response = await request('/api/ratings', { method: 'POST', headers: { origin: 'https://verification.invalid', 'content-type': 'application/json' }, body: '{}' });
      insist(response.status === 403, 'Cross-origin rating submission must return 403.');
      insist(typeof (await json(response)).error === 'string', 'Forbidden write must use the JSON error contract.');
      return 'Rating endpoint rejects a foreign Origin header.';
    }),
    check('oauth-entry-redirect', async () => {
      const response = await request('/auth/login');
      insist([302, 303, 307, 308].includes(response.status), 'Discord sign-in entry must redirect.');
      const location = response.headers.get('location');
      insist(location, 'OAuth redirect is missing its destination.');
      const target = new URL(location, origin);
      insist(target.origin === authOrigin && target.pathname === '/auth/v1/authorize', 'OAuth entry must target the configured Supabase Auth gateway.');
      insist(target.searchParams.get('provider') === 'discord', 'OAuth entry did not select Discord.');
      insist(target.searchParams.get('redirect_to') === `${origin}/auth/callback`, 'OAuth callback does not match the deployed application origin.');
      return 'Entry redirect reaches configured Discord OAuth initiation; provider callback and real login remain separate checks.';
    }),
    check('service-worker-and-offline', async () => {
      const response = await request('/sw.js');
      insist(response.status === 200 && /javascript/.test(response.headers.get('content-type') || ''), 'Service worker must return JavaScript with status 200.');
      insist(/no-cache|no-store/.test(response.headers.get('cache-control') || ''), 'Service worker must require revalidation.');
      await body(response);
      const offline = await request('/offline.html');
      insist(offline.status === 200 && offline.headers.get('content-type')?.includes('text/html'), 'Offline fallback must return HTML with status 200.');
      await body(offline);
      return 'Service worker and offline fallback are served; actual installation requires a device check.';
    }),
  ]);

  await check('icons', async () => {
    insist(manifest, 'Cannot verify icons without a valid manifest.');
    const pngIcons = manifest.icons!.filter(icon => ['192x192', '512x512'].includes(icon.sizes || ''));
    for (const icon of [...pngIcons, { src: '/apple-touch-icon.png', sizes: '180x180' }]) {
      const response = await request(icon.src);
      insist(response.status === 200 && response.headers.get('content-type')?.includes('image/png'), 'An install icon did not return PNG with status 200.');
      const bytes = await body(response);
      insist(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'An install icon has an invalid PNG signature.');
      const expected = Number(icon.sizes!.split('x')[0]);
      insist(bytes.readUInt32BE(16) === expected && bytes.readUInt32BE(20) === expected, 'An install icon has incorrect pixel dimensions.');
    }
    return '192px, 512px and Apple 180px PNG dimensions verified.';
  });
  checks.sort((a, b) => a.name.localeCompare(b.name));
  return {
    checkedAt: new Date().toISOString(), origin, release,
    publicHttps: origin.startsWith('https:'),
    passed: checks.every(result => result.status === 'pass'), checks,
    remainingEvidence: ['Railway terminal SUCCESS for this release', 'Real Discord provider callback and verified session', 'Install and launch on a real device', 'Authenticated photo-required rating, reload, history and photo access', 'Actual Discord announcement receipt', 'Restart persistence and backup restore reconciliation'],
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npx tsx scripts/verify-launch.ts <https://app-origin> [--allow-local]\nEnvironment: VERIFY_BASE_URL, VERIFY_AUTH_ORIGIN (or NEXT_PUBLIC_SUPABASE_URL), EXPECTED_RELEASE. No cookies or credentials are used.');
    return;
  }
  insist(args.every(arg => !arg.startsWith('--') || arg === '--allow-local'), 'Unknown verification option. Use --help.');
  const baseUrl = args.find(arg => !arg.startsWith('--')) || process.env.VERIFY_BASE_URL;
  const authOrigin = process.env.VERIFY_AUTH_ORIGIN || process.env.NEXT_PUBLIC_SUPABASE_URL;
  insist(baseUrl && authOrigin, 'Set the app origin and VERIFY_AUTH_ORIGIN. Use --help.');
  const result = await verifyLaunch({ baseUrl, authOrigin, expectedRelease: process.env.EXPECTED_RELEASE, allowLocal: args.includes('--allow-local') });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => { console.error('Launch verification could not run. Check the origin/options and use --help; no response bodies or credentials were logged.'); process.exitCode = 1; });
}
