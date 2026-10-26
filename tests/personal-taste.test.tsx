import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {TasteProfiles,RecommendationList} from '../src/components/personal-taste';
import type {TasteInsights} from '../src/lib/contracts';

const person={id:'friend',displayName:'Mia',avatarUrl:null};
const insight={matches:[{person,sharedCount:4,meanDifference:.5,similarCount:4,disagreements:[]}],divisive:[],recommendations:[{itemId:'drink',itemName:'Untried tea',brand:'Maker',type:'Tea',sources:[{person,score:9,sharedCount:4,meanDifference:.5}]}]} satisfies TasteInsights;
describe('personal taste explanations',()=>{
 it('shows actual shared-item evidence and links to a person and their recommendations',()=>{
  const html=renderToStaticMarkup(<TasteProfiles matches={insight.matches} person={()=>{}} recommend={()=>{}}/>);
  expect(html).toContain('Mia');expect(html).toContain('4 shared items');expect(html).toContain('0.5');expect(html).toContain('See recommendations');
 });
 it('shows who rated a recommended drink without presenting a predicted personal score',()=>{
  const html=renderToStaticMarkup(<RecommendationList insights={insight} profile="" choose={()=>{}} open={()=>{}}/>);
  expect(html).toContain('Untried tea');expect(html).toContain('Mia');expect(html).toContain('9.0');expect(html).toContain('4 shared items');expect(html).not.toContain('predicted');
 });
 it('explains missing shared evidence and missing high-rated unseen drinks separately',()=>{
  expect(renderToStaticMarkup(<TasteProfiles matches={[]} person={()=>{}} recommend={()=>{}}/>)).toContain('three');
  expect(renderToStaticMarkup(<RecommendationList insights={{...insight,recommendations:[]}} profile="" choose={()=>{}} open={()=>{}}/>)).toContain('8/10');
 });
 it('keeps distant profiles visible without offering them as recommendation sources',()=>{
  const far={...insight.matches[0],meanDifference:2.4};
  const profiles=renderToStaticMarkup(<TasteProfiles matches={[far]} person={()=>{}} recommend={()=>{}}/>);
  expect(profiles).toContain('Mia');expect(profiles).not.toContain('See recommendations');
  const picks=renderToStaticMarkup(<RecommendationList insights={{...insight,matches:[far],recommendations:[]}} profile="" choose={()=>{}} open={()=>{}}/>);
  expect(picks).toContain('No close taste matches yet');
 });
});
