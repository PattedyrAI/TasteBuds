import {afterEach,describe,expect,it,vi} from 'vitest';
import {fetchPlaceLocation} from '../src/server/google-places';

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('Google-posisjoner',()=>{
  it('henter kun identitet og posisjon med servernøkkelen i header',async()=>{
    vi.stubEnv('GOOGLE_PLACES_SERVER_KEY','private-test-key');
    const fetch=vi.fn().mockResolvedValue(Response.json({id:'place-1',location:{latitude:59.91,longitude:10.75}}));
    vi.stubGlobal('fetch',fetch);
    expect(await fetchPlaceLocation('place-1')).toEqual({lat:59.91,lng:10.75});
    const [url,options]=fetch.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places/place-1');
    expect(options.headers).toMatchObject({'X-Goog-FieldMask':'id,location','X-Goog-Api-Key':'private-test-key'});
    expect(options.cache).toBe('no-store');
  });
  it.each([{id:'other',location:{latitude:59,longitude:10}},{id:'place-1',location:{latitude:91,longitude:10}},{id:'place-1'}])('avviser ufullstendig eller ugyldig posisjon',async payload=>{
    vi.stubEnv('GOOGLE_PLACES_SERVER_KEY','test');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(fetchPlaceLocation('place-1')).rejects.toMatchObject({status:502});
  });
  it('lekker ikke leverandørfeil eller nøkkel',async()=>{
    vi.stubEnv('GOOGLE_PLACES_SERVER_KEY','private-test-key');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private-test-key',{status:403})));
    await expect(fetchPlaceLocation('place-1')).rejects.toMatchObject({status:502,message:'Kunne ikke hente plasseringen fra Google. Prøv igjen senere.'});
  });
  it('avviser ugyldig ID og manglende oppsett før nettverkskall',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);vi.stubEnv('GOOGLE_PLACES_SERVER_KEY','');
    await expect(fetchPlaceLocation('../secret')).rejects.toMatchObject({status:400});
    await expect(fetchPlaceLocation('place-1')).rejects.toMatchObject({status:503});
    expect(fetch).not.toHaveBeenCalled();
  });
});
