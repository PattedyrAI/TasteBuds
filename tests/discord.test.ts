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
  it('attributes the current score to the linked Discord reviewer without pings',()=>{
    const payload=makeRatingEmbed({itemName:'Burger',displayName:'Pat',discordId:'123456789012345678',score:9.9,itemId:'item'},'https://example.com');
    expect(payload.embeds[0].fields[0].value).toBe('**9.9 / 10** — <@123456789012345678>\n🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩');
    expect(payload.allowed_mentions).toEqual({parse:[]});
  });
  it.each([null,undefined,'not-an-id','123> <@456'])('uses a bounded escaped name if the reviewer has no valid Discord ID (%s)',discordId=>{
    const embed=makeRatingEmbed({itemName:'Burger',displayName:'**Pat**\n<@123>',discordId,score:9.9,itemId:'item'},'https://example.com').embeds[0];
    expect(embed.fields[0].value.split('\n')[0]).toBe('**9.9 / 10** — @\\*\\*Pat\\*\\* \\<@123\\>');
  });
  it('shows at most three previous ratings with Discord users and decimal scores',()=>{
    const recentRatings=[
      {discordId:'123456789012345678',displayName:'Discord reviewer',score:8.5},
      {discordId:null,displayName:'Tea friend',score:6.7},
      {discordId:'223456789012345678',displayName:'Another reviewer',score:10},
      {discordId:null,displayName:'Older reviewer',score:2},
    ];
    const payload=makeRatingEmbed({itemName:'Drink',displayName:'Pat',score:9,itemId:'item',category:'Energy-drink review',recentRatings},'https://example.com');
    expect(payload.embeds[0].fields[1]).toEqual({name:'3 LAST RATINGS OF THIS DRINK',value:'<@123456789012345678> - 8.5 / 10\n@Tea friend - 6.7 / 10\n<@223456789012345678> - 10 / 10',inline:false});
    expect(payload.allowed_mentions).toEqual({parse:[]});
  });
  it.each([1,2])('shows only the %s previous ratings available',count=>{
    const recentRatings=Array.from({length:count},()=>({discordId:null,displayName:'Reviewer',score:7}));
    const embed=makeRatingEmbed({itemName:'Drink',displayName:'Pat',score:9,itemId:'item',recentRatings},'https://example.com').embeds[0];
    expect(embed.fields[1].value.split('\n')).toHaveLength(count);
  });
  it.each([['Food review','FOOD'],[undefined,'PRODUCT']])('uses an accurate history heading for %s', (category,label)=>{
    const recentRatings=[{discordId:null,displayName:'Reviewer',score:7}];
    const embed=makeRatingEmbed({itemName:'Burger',displayName:'Pat',score:9,itemId:'item',category,recentRatings},'https://example.com').embeds[0];
    expect(embed.fields[1].name).toBe(`3 LAST RATINGS OF THIS ${label}`);
  });
  it('omits empty rating history and keeps fallback names on one bounded line',()=>{
    const input={itemName:'Drink',displayName:'Pat',score:9,itemId:'item'};
    expect(makeRatingEmbed({...input,recentRatings:[]},'https://example.com').embeds[0].fields).toHaveLength(1);
    const recentRatings=[{discordId:null,displayName:'**Name**\n<@123>',score:7},{discordId:null,displayName:'x'.repeat(2000),score:8}];
    const field=makeRatingEmbed({...input,recentRatings},'https://example.com').embeds[0].fields[1];
    expect(field.value.split('\n')).toHaveLength(2);
    expect(field.value).toContain('@\\*\\*Name\\*\\* \\<@123\\> - 7 / 10');
    expect(field.value.length).toBeLessThanOrEqual(1024);
  });
  it('includes a native app button and an attached photo without a public photo URL',()=>{
    const payload=makeRatingEmbed({itemName:'Burger',displayName:'Reviewer',score:9,itemId:'item/1',photoFilename:'review.png'},'https://example.com');
    expect(payload.embeds[0]).toMatchObject({image:{url:'attachment://review.png'}});
    expect(payload.embeds[0].fields[0]).toEqual({name:'Score',value:'**9 / 10** — @Reviewer\n🟩🟩🟩🟩🟩🟩🟩🟩🟩⬛',inline:false});
    expect(payload.components).toEqual([{type:1,components:[{type:2,style:5,label:'Open in TasteBuds',url:'https://example.com/app?item=item%2F1'}]}]);
    expect(JSON.stringify(payload)).not.toContain('/api/photos/');
  });
  it('titles the review with brand, model and variant and reads the verdict from the colour',()=>{
    const embed=makeRatingEmbed({itemName:'Original',brand:'Red Bull',variant:'Sugarfree',displayName:'Pat',score:4.5,note:'Cold\nand sweet',itemId:'item',category:'Energy-drink review',groupName:'Office',ratedAt:'2026-09-28T10:05:00.000Z'},'https://example.com').embeds[0];
    expect(embed).toMatchObject({title:'Red Bull Original · Sugarfree',author:{name:'Pat · Energy-drink review'},description:'> Cold\n> and sweet',color:0xe5484d,footer:{text:'TasteBuds · Office'},timestamp:'2026-09-28T10:05:00.000Z'});
    expect(embed.fields[0].value).toBe('**4.5 / 10** — @Pat\n🟥🟥🟥🟥🟥⬛⬛⬛⬛⬛');
  });
  it('does not repeat a brand already in the item name or show an empty quote',()=>{
    const embed=makeRatingEmbed({itemName:'Monster Ultra',brand:'Monster',displayName:'Pat',score:8,note:'  ',itemId:'item'},'https://example.com').embeds[0];
    expect(embed.title).toBe('Monster Ultra');expect(embed).not.toHaveProperty('description');expect(embed.color).toBe(0x2fb466);
  });
  it.each(['Energy-drink review','Food review',undefined])('labels rereviews in the author line for %s',category=>{
    const embed=makeRatingEmbed({itemName:'Peachberry',displayName:'bristiaan',score:8.5,itemId:'item',category,isRereview:true},'https://example.com').embeds[0];
    expect(embed.author.name).toBe(category?`bristiaan · ${category} · REREVIEW`:'bristiaan · REREVIEW');
  });
  it.each([false,undefined])('does not label first reviews or older payloads as rereviews (%s)',isRereview=>{
    const embed=makeRatingEmbed({itemName:'Peachberry',displayName:'bristiaan',score:8.5,itemId:'item',category:'Energy-drink review',isRereview},'https://example.com').embeds[0];
    expect(embed.author.name).toBe('bristiaan · Energy-drink review');
  });
});
