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
});
