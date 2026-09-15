import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {getPool} from '../src/server/db';
import {createGroup,ensureUser} from '../src/server/service';
import {uploadPhoto,getPhoto} from '../src/server/photos';
import {recognize} from '../src/server/recognition';
const url=process.env.TEST_DATABASE_URL;
if(url&&(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Disposable local test DB required');
if(url)process.env.DATABASE_URL=url;
const user=randomUUID(),outsider=randomUUID();let group:string,photo:string;
const payload={candidates:[{content:{parts:[{text:JSON.stringify({name:'Test lemon drink',brand:null,variant:null,type:'Drink',broadCategory:'Food & Drink',confidence:.8})}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:30}};
describe.skipIf(!url)('photo and recognition boundaries',()=>{
  beforeAll(async()=>{
    await ensureUser({id:user,displayName:'Recognition test'});await ensureUser({id:outsider,displayName:'Other test'});
    group=(await createGroup(user,{name:'Recognition '+randomUUID()})).id;
    const data=await sharp({create:{width:2000,height:1000,channels:3,background:'#ffdd00'}}).jpeg().withMetadata().toBuffer();
    photo=(await uploadPhoto(user,group,data)).id;
    process.env.GEMINI_API_KEY='local-mock-only';process.env.RECOGNITION_DAILY_LIMIT='30';
  });
  afterEach(()=>vi.unstubAllGlobals());afterAll(async()=>{await getPool().end();});
  it('re-encodes photos, strips metadata and checks membership',async()=>{
    const p=await getPhoto(user,photo);const metadata=await sharp(p.data).metadata();
    expect(metadata.width).toBe(1600);expect(metadata.height).toBe(800);expect(metadata.exif).toBeUndefined();
    await expect(getPhoto(outsider,photo)).rejects.toMatchObject({status:404});
    await expect(uploadPhoto(outsider,group,Buffer.from('bad'))).rejects.toMatchObject({status:404});
  });
  it('reserves a single in-flight provider call and caches successful results',async()=>{
    let release!:(value:Response)=>void;let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
    const fetchMock=vi.fn(()=>{entered();return new Promise<Response>(resolve=>release=resolve);});vi.stubGlobal('fetch',fetchMock);
    const first=recognize(user,photo);await started;
    const second=await recognize(user,photo);
    expect(second.status).toBe('failed');expect(second.message).toContain('being read');
    release(Response.json(payload));expect((await first).status).toBe('completed');
    expect((await recognize(user,photo)).suggestion?.brand).toBeNull();expect(fetchMock).toHaveBeenCalledTimes(1);
    const jobs=await getPool().query('SELECT input_tokens,output_tokens FROM everrate.recognition_jobs WHERE photo_id=$1',[photo]);
    expect(jobs.rows).toEqual([{input_tokens:100,output_tokens:30}]);
  });
  it('keeps an uploaded photo usable after provider failure and applies quota',async()=>{
    const data=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).jpeg().toBuffer();const p=await uploadPhoto(user,group,data);
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('Unavailable',{status:503})));
    expect((await recognize(user,p.id)).status).toBe('failed');expect((await getPhoto(user,p.id)).data.length).toBeGreaterThan(0);
    process.env.RECOGNITION_DAILY_LIMIT='1';await expect(recognize(user,p.id)).rejects.toMatchObject({status:429});
  });
});
