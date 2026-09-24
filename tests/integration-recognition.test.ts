import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../scripts/migrate';
import sharp from 'sharp';
import {getPool} from '../src/server/db';
import {createGroup,ensureUser,updatePreferences} from '../src/server/service';
import {uploadPhoto,getPhoto,readImageBody} from '../src/server/photos';
import {recognize} from '../src/server/recognition';
const url=process.env.TEST_DATABASE_URL;
if(url&&(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Disposable local test DB required');
let admin:Pool,database:string;
const user=randomUUID(),outsider=randomUUID();let group:string,photo:string;
const payload={candidates:[{content:{parts:[{text:JSON.stringify({name:'Test lemon drink',brand:null,variant:null,type:'Drink',broadCategory:'Food & Drink',confidence:.8})}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:30}};
describe.skipIf(!url)('photo and recognition boundaries',()=>{
  beforeAll(async()=>{
    admin=new Pool({connectionString:url});database='everrate_recognition_'+randomUUID().replaceAll('-','')+'_test';await admin.query(`CREATE DATABASE "${database}"`);const target=new URL(url!);target.pathname='/'+database;await migrate(target.toString());process.env.DATABASE_URL=target.toString();
    await ensureUser({id:user,displayName:'Recognition test'});await ensureUser({id:outsider,displayName:'Other test'});
    await updatePreferences(user,{aiEnabled:true});
    group=(await createGroup(user,{name:'Recognition '+randomUUID()})).id;
    const data=await sharp({create:{width:2000,height:1000,channels:3,background:'#ffdd00'}}).jpeg().withMetadata().toBuffer();
    photo=(await uploadPhoto(user,group,data)).id;
    process.env.GEMINI_API_KEY='local-mock-only';process.env.RECOGNITION_DAILY_LIMIT='30';
  });
  afterEach(()=>vi.unstubAllGlobals());afterAll(async()=>{await getPool().end();await admin.query(`DROP DATABASE "${database}"`);await admin.end();});
  it('re-encodes photos, strips metadata and checks membership',async()=>{
    const p=await getPhoto(user,photo);const metadata=await sharp(p.data).metadata();
    expect(metadata.width).toBe(1600);expect(metadata.height).toBe(800);expect(metadata.exif).toBeUndefined();
    await expect(getPhoto(outsider,photo)).rejects.toMatchObject({status:404});
    await expect(uploadPhoto(outsider,group,Buffer.from('bad'))).rejects.toMatchObject({status:404});
  });
  it('uploads actual JPGs even when browser type metadata is missing or nonstandard',async()=>{
    const jpeg=await sharp({create:{width:7,height:5,channels:3,background:'blue'}}).jpeg({progressive:true}).toBuffer();
    for(const type of ['image/jpeg','image/jpg','','application/octet-stream']){
      const body=await readImageBody(new Request('https://example.test/api/photos',{method:'POST',headers:type?{'Content-Type':type}:{},body:new Uint8Array(jpeg)}));
      const uploaded=await uploadPhoto(user,group,body),stored=await getPhoto(user,uploaded.id);
      expect(uploaded).toMatchObject({mimeType:'image/jpeg',width:7,height:5});
      expect((await sharp(stored.data).metadata()).format).toBe('jpeg');
    }
  });
  it('rejects non-image bytes and unsupported content masquerading as a JPG',async()=>{
    for(const input of [Buffer.from('not a photo'),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>')])await expect(uploadPhoto(user,group,input)).rejects.toMatchObject({status:400});
  });
  it('stores a 48-megapixel phone JPG as a small photo without EXIF metadata',async()=>{
    const jpeg=await sharp({create:{width:8064,height:6048,channels:3,background:'#ccbbaa'}}).jpeg().withMetadata().toBuffer();
    const body=await readImageBody(new Request('https://example.test/api/photos',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:new Uint8Array(jpeg)}));
    const uploaded=await uploadPhoto(user,group,body),stored=await getPhoto(user,uploaded.id);
    expect(uploaded).toMatchObject({mimeType:'image/jpeg',width:1600,height:1200});
    expect((await sharp(stored.data).metadata()).exif).toBeUndefined();
  });
  it('explains when a photo exceeds the supported pixel limit',async()=>{
    const jpeg=await sharp({create:{width:8100,height:8100,channels:3,background:'blue'}}).jpeg().toBuffer();
    await expect(uploadPhoto(user,group,jpeg)).rejects.toMatchObject({status:400,message:'This photo is over 64 megapixels. Export a smaller copy and try again.'});
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
