import {describe,it,expect} from 'vitest';
import {validateWebhook,encryptWebhook,decryptWebhook,makeRatingEmbed} from '../src/server/discord-format';
describe('Discord secrets and payloads',()=>{
  it('rejects arbitrary hosts, userinfo and redirects',()=>{
    for(const url of ['http://discord.com/api/webhooks/123/abc','https://evil.test/api/webhooks/123/abc','https://discord.com@evil.test/api/webhooks/123/abc','https://discord.com/api/webhooks/123/abc?wait=true'])expect(()=>validateWebhook(url)).toThrow();
  });
  it('encrypts webhook credentials with tamper detection',()=>{
    const key='ab'.repeat(32),value='https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz';
    const encrypted=encryptWebhook(value,key);expect(encrypted).not.toContain(value);expect(decryptWebhook(encrypted,key)).toBe(value);
    expect(()=>decryptWebhook(encrypted,'cd'.repeat(32))).toThrow();
  });
  it('never lets rating content mention a channel',()=>{
    const payload=makeRatingEmbed({itemName:'@everyone',displayName:'Someone',score:8,note:'@here',itemId:'item'},'https://example.com');
    expect(payload.allowed_mentions).toEqual({parse:[]});
  });
  it('includes a native app button and an attached photo without a public photo URL',()=>{
    const payload=makeRatingEmbed({itemName:'Burger',displayName:'Reviewer',score:9,itemId:'item/1',photoFilename:'review.png'},'https://example.com');
    expect(payload.embeds[0]).toMatchObject({image:{url:'attachment://review.png'}});
    expect(payload.embeds[0].fields[0]).toEqual({name:'TASTE SCORE',value:'9 / 10',inline:true});
    expect(payload.components).toEqual([{type:1,components:[{type:2,style:5,label:'Open TasteBuds',url:'https://example.com/app?item=item%2F1'}]}]);
    expect(JSON.stringify(payload)).not.toContain('/api/photos/');
  });
});
