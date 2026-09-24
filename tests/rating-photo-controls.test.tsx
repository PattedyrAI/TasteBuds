import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RatingForm} from '../src/components/rating-form';

describe('review photo choices',()=>{
  it('offers camera capture separately from library upload',()=>{
    const html=renderToStaticMarkup(<RatingForm groupId="group" categories={[]} close={()=>{}} saved={()=>{}}/>);
    const inputs=html.match(/<input\b[^>]*type="file"[^>]*>/g)||[];
    expect(inputs).toHaveLength(2);
    expect(inputs.find(input=>input.includes('aria-label="Take a photo"'))).toContain('capture="environment"');
    expect(inputs.find(input=>input.includes('aria-label="Take a photo"'))).toContain('accept="image/*"');
    expect(inputs.find(input=>input.includes('aria-label="Upload a photo"'))).not.toContain('capture=');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[\s\S]*?Take a photo<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[\s\S]*?Upload a photo<\/button>/);
  });
});
