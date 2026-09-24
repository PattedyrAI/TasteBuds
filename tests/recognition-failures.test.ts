import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),getPhoto:vi.fn(),matches:vi.fn(),fetch:vi.fn()}));
vi.mock('../src/server/db',()=>({query:mocks.query,getPool:()=>({query:mocks.query}),transaction:async(work:(db:unknown)=>unknown)=>work({query:mocks.query})}));
vi.mock('../src/server/photos',()=>({getPhoto:mocks.getPhoto}));
vi.mock('../src/server/item-matches',()=>({findItemMatches:mocks.matches}));
vi.mock('../src/server/auth',()=>({HttpError:class extends Error{constructor(message:string,public status:number){super(message);}}}));
import {recognize} from '../src/server/recognition';
const user='10000000-0000-4000-8000-000000000001',photo='10000000-0000-4000-8000-000000000002',job='10000000-0000-4000-8000-000000000003';
const secret='private-test-key',image=Buffer.from('private-photo-content');
const suggestion={name:'Coffee',brand:null,variant:null,type:'Coffee',broadCategory:'Food & Drink',confidence:.8};
let warn:ReturnType<typeof vi.spyOn>;
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv('GEMINI_API_KEY',secret);vi.stubEnv('GEMINI_MODEL','gemini-3.5-flash-lite');vi.stubGlobal('fetch',mocks.fetch);
  warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT ai_enabled')?[{ai_enabled:true}]:sql.includes('count(*)')?[{n:0}]:sql.startsWith('INSERT')?[{id:job}]:[],rowCount:0}));
  mocks.getPhoto.mockResolvedValue({id:photo,owner_id:user,group_id:'group',sha256:'photo-hash',data:image,mime_type:'image/jpeg'});
  mocks.matches.mockResolvedValue([]);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('recognition failure explanations and private diagnostics',()=>{
  it.each([[402,'billing'],[429,'rate-limited'],[401,'configuration'],[403,'configuration'],[404,'configuration'],[503,'unavailable']])('explains provider %s without blaming the photo',async(status,explanation)=>{
    mocks.fetch.mockResolvedValue(new Response(secret+' '+image.toString(),{status:Number(status)}));
    const result=await recognize(user,photo);
    expect(result).toMatchObject({status:'failed',suggestion:null,matches:[]});
    expect(result.message).toContain(explanation);expect(result.message).toContain('photo is still attached');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("status='failed'"),[job,`provider_${status}`]);
    expect(warn).toHaveBeenCalledWith('Photo recognition failed',expect.objectContaining({jobId:job,model:'gemini-3.5-flash-lite',failureClass:`provider_${status}`,durationMs:expect.any(Number)}));
    const output=JSON.stringify([result,warn.mock.calls]);expect(output).not.toContain(secret);expect(output).not.toContain(image.toString());expect(output).not.toContain(image.toString('base64'));
    expect(mocks.matches).not.toHaveBeenCalled();
  });
  it('distinguishes a provider timeout',async()=>{
    mocks.fetch.mockRejectedValue(new DOMException('private timeout details','TimeoutError'));
    expect((await recognize(user,photo)).message).toContain('too long');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("status='failed'"),[job,'provider_timeout']);
  });
  it('does not persist or log arbitrary upstream error messages',async()=>{
    mocks.fetch.mockRejectedValue(new Error(`not_configured ${secret} ${image}`));
    const result=await recognize(user,photo);
    expect(result.message).toContain('unavailable');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("status='failed'"),[job,'recognition_failed']);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  });
  it('keeps an unreadable photo distinct from service failures',async()=>{
    mocks.fetch.mockResolvedValue(Response.json({candidates:[]}));
    expect((await recognize(user,photo)).message).toContain('could not identify');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("status='failed'"),[job,'unrecognised']);
  });
  it('keeps provider configuration errors out of the photo explanation',async()=>{
    vi.stubEnv('GEMINI_API_KEY','');
    expect((await recognize(user,photo)).message).toContain('configuration');expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each(['not-json',JSON.stringify({name:'Coffee',confidence:'invalid'})])('classifies malformed provider output without logging it',async text=>{
    mocks.fetch.mockResolvedValue(Response.json({candidates:[{content:{parts:[{text}]}}]}));
    expect((await recognize(user,photo)).message).toContain('unavailable');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("status='failed'"),[job,'invalid_response']);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(text);
  });
  it('never calls the provider when AI consent is disabled',async()=>{
    mocks.query.mockResolvedValue({rows:[{ai_enabled:false}],rowCount:1});
    await expect(recognize(user,photo)).rejects.toMatchObject({status:403});expect(mocks.fetch).not.toHaveBeenCalled();expect(warn).not.toHaveBeenCalled();
  });
  it('retains successful suggestions and avoids failure logging',async()=>{
    mocks.fetch.mockResolvedValue(Response.json({candidates:[{content:{parts:[{text:JSON.stringify(suggestion)}]}}]}));
    expect(await recognize(user,photo)).toMatchObject({status:'completed',suggestion});expect(warn).not.toHaveBeenCalled();
  });
  it('honors consent revoked after the recognition job was reserved',async()=>{
    let checks=0;
    mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT ai_enabled')?[{ai_enabled:++checks<3}]:sql.includes('count(*)')?[{n:0}]:sql.startsWith('INSERT')?[{id:job}]:[],rowCount:0}));
    await expect(recognize(user,photo)).rejects.toMatchObject({status:403});expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("status='failed'"),[job,'ai_disabled']);
  });
});
