import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ImportRatings} from '../src/components/import-ratings';
import type {GroupDetail} from '../src/lib/contracts';
describe('rating import controls',()=>{
 it('labels source and destination categories and disables import until choices are made',()=>{
  const group:GroupDetail={id:'target',name:'Destination',ownerId:'owner',role:'member',memberCount:2,createdAt:'2026-01-01',mapsEnabled:false,inviteCode:null,members:[],discordConnected:false,stats:{itemCount:0,tastingCount:0,activeMembers:0},categories:[{id:'category',name:'Drinks',fields:[]}]};
  const html=renderToStaticMarkup(<ImportRatings group={group} groups={[group,{...group,id:'source',name:'Source'}]} changed={()=>{}}/>);
  expect(html).toContain('From group<select required');expect(html).toContain('value="source">Source');expect(html).not.toContain('value="target"');
  expect(html).toContain('From category<select required');expect(html).toContain('Into category in Destination<select required');expect(html).toContain('value="category">Drinks');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Import all my ratings in this category<\/button>/);
 });
});
