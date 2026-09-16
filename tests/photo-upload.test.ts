import {describe,it,expect} from 'vitest';
import sharp from 'sharp';
import {readImageBody} from '../src/server/photos';
describe('photo upload request types',()=>{
 it.each(['image/jpeg','image/jpg','image/pjpeg','IMAGE/JPEG; charset=binary','','application/octet-stream'])('accepts JPEG bytes reported as %s',async type=>{
  const jpeg=await sharp({create:{width:3,height:2,channels:3,background:'#ffcc00'}}).jpeg().toBuffer();
  const request=new Request('https://example.test/api/photos',{method:'POST',headers:type?{'Content-Type':type}:{},body:new Uint8Array(jpeg)});
  expect(await readImageBody(request)).toEqual(jpeg);
 });
 it('rejects non-image request types',async()=>{await expect(readImageBody(new Request('https://example.test/api/photos',{method:'POST',headers:{'Content-Type':'text/html'},body:'not a photo'}))).rejects.toMatchObject({status:400});});
 it('retains the streamed 10MB upload limit for generic file types',async()=>{await expect(readImageBody(new Request('https://example.test/api/photos',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(10*1024*1024+1)}))).rejects.toMatchObject({status:413});});
});
