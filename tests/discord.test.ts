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
    expect(payload.embeds[0].fields[0]).toEqual({name:'Score',value:'**9 / 10**\n🟩🟩🟩🟩🟩🟩🟩🟩🟩⬛',inline:false});
    expect(payload.components).toEqual([{type:1,components:[{type:2,style:5,label:'Open in TasteBuds',url:'https://example.com/app?item=item%2F1'}]}]);
    expect(JSON.stringify(payload)).not.toContain('/api/photos/');
  });
  it('titles the review with brand, model and variant and reads the verdict from the colour',()=>{
    const embed=makeRatingEmbed({itemName:'Original',brand:'Red Bull',variant:'Sugarfree',displayName:'Pat',score:4.5,note:'Cold\nand sweet',itemId:'item',category:'Energy-drink review',groupName:'Office',ratedAt:'2026-09-28T10:05:00.000Z'},'https://example.com').embeds[0];
    expect(embed).toMatchObject({title:'Red Bull Original · Sugarfree',author:{name:'Pat · Energy-drink review'},description:'> Cold\n> and sweet',color:0xe5484d,footer:{text:'TasteBuds · Office'},timestamp:'2026-09-28T10:05:00.000Z'});
    expect(embed.fields[0].value).toBe('**4.5 / 10**\n🟥🟥🟥🟥🟥⬛⬛⬛⬛⬛');
  });
  it('does not repeat a brand already in the item name or show an empty quote',()=>{
    const embed=makeRatingEmbed({itemName:'Monster Ultra',brand:'Monster',displayName:'Pat',score:8,note:'  ',itemId:'item'},'https://example.com').embeds[0];
    expect(embed.title).toBe('Monster Ultra');expect(embed).not.toHaveProperty('description');expect(embed.color).toBe(0x2fb466);
  });
});
