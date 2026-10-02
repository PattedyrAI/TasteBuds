import {afterEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {friendScoreFor,latestScores,loadAllPersonRatings} from '../src/components/friend-compare';
import {ScoreBar} from '../src/components/score-bar';
import type {PersonRating} from '../src/lib/contracts';

const rating=(itemId:string,score:number,countsTowardAverage?:boolean)=>({itemId,score,countsTowardAverage}) as PersonRating;
afterEach(()=>vi.unstubAllGlobals());
describe('friend comparison',()=>{
 it('uses the current counted tasting even when a newer noncounting rereview arrives first',()=>{
  expect([...latestScores([rating('a',3,false),rating('a',8,true),rating('a',6,false),rating('b',0,true)])]).toEqual([['a',8],['b',0]]);
 });
 it('keeps the newest score for older responses without count metadata',()=>{
  expect(latestScores([rating('a',8),rating('a',5)]).get('a')).toBe(8);
 });
 it('loads all pages and forwards cancellation to every request',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ratings:[rating('a',8)],nextCursor:'next +/='}))).mockResolvedValueOnce(new Response(JSON.stringify({ratings:[rating('b',4)],nextCursor:null})));
  vi.stubGlobal('fetch',fetcher);const controller=new AbortController();
  const result=await loadAllPersonRatings('group','friend',controller.signal);
  expect(result.map(r=>r.itemId)).toEqual(['a','b']);
  expect(fetcher.mock.calls[1][0]).toContain('cursor=next%20%2B%2F%3D');
  expect(fetcher.mock.calls.every(call=>call[1].signal===controller.signal)).toBe(true);
 });
 it('rejects partial results when a later page fails',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ratings:[rating('a',8)],nextCursor:'next'}))).mockResolvedValueOnce(new Response(JSON.stringify({error:'Unavailable'}),{status:503})));
  await expect(loadAllPersonRatings('g','f',new AbortController().signal)).rejects.toThrow('Unavailable');
 });
 it('stops a repeated cursor instead of looping forever',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({ratings:[],nextCursor:'same'})))));
  await expect(loadAllPersonRatings('g','f',new AbortController().signal)).rejects.toThrow('every rating');
 });
 it('distinguishes pending, failed, missing and a genuine zero',()=>{
  expect(friendScoreFor({status:'loading',name:'Friend'},'a')?.state).toBe('loading');
  expect(friendScoreFor({status:'error',name:'Friend',error:'No',retry:()=>{}},'a')?.state).toBe('error');
  const ready={status:'ready' as const,name:'Friend',scores:new Map([['a',0]])};
  expect(friendScoreFor(ready,'a')).toEqual({name:'Friend',state:'ready',score:0});
  expect(friendScoreFor(ready,'b')).toEqual({name:'Friend',state:'ready',score:null});
 });
 it('shows proportional fill with the readable score and no fill for unrated',()=>{
  const html=renderToStaticMarkup(<ScoreBar label="You" score={6.5} tone="mine" empty="Not tried"/>);
  expect(html).toContain('width:65%');expect(html).toContain('6.5');
  const empty=renderToStaticMarkup(<ScoreBar label="You" score={null} tone="mine" empty="Not tried"/>);
  expect(empty).toContain('Not tried');expect(empty).not.toContain('score-fill');
 });
});
