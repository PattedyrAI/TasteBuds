import type {CSSProperties} from 'react';
import {browseCategory} from '../domain/browse-categories';
/** Stable category colours: labels stay visible so colour is never the only cue. */
const tones={
 lime:['#e9f3c9','#38531d','#bdd67b'],amber:['#fff0ce','#77501a','#ecc67a'],
 rose:['#ffe5ec','#87334d','#eab0c0'],aqua:['#dcf2ee','#225f58','#94cec3'],
 lilac:['#eee7fa','#604486','#cbb7e6'],peach:['#ffe9da','#884625','#e5b595'],
 slate:['#edf0f5','#49576e','#c8d0dd'],
} as const;
export function categoryTone(type:string|null){
 const name=(browseCategory(type)??'').toLowerCase();
 if(!name)return 'slate';
 if(/energy|tea|water/.test(name))return 'lime';
 if(/mac|cheese|pasta|noodle/.test(name))return 'amber';
 if(/cake|dessert|candy|ice cream|cookie|donut/.test(name))return 'rose';
 if(/fish|salad|sushi|seafood/.test(name))return 'aqua';
 if(/beer|cocktail|seltzer|liqueur/.test(name))return 'lilac';
 if(/nicotine/.test(name))return 'slate';
 if(/snack|rice/.test(name))return 'amber';
 if(/soft drink/.test(name))return 'lime';
 if(/burger|sandwich|chicken|pizza|fries/.test(name))return 'peach';
 const choices=['lime','amber','rose','aqua','lilac','peach'] as const;
 return choices[Array.from(name).reduce((sum,c)=>sum+c.charCodeAt(0),0)%choices.length];
}
export function categoryStyle(type:string|null):CSSProperties{
 const [background,ink,line]=tones[categoryTone(type)];
 return {'--category-bg':background,'--category-ink':ink,'--category-line':line} as CSSProperties;
}
