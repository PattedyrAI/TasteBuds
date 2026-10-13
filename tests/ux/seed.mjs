// Seeds a disposable local database through the real HTTP API. Refuses non-local targets.
import {readFileSync,readdirSync} from 'node:fs';
import {sessionCookie} from './fake-auth.mjs';
const base=process.env.APP_URL||'http://localhost:3100';
if(!/^http:\/\/(localhost|127\.0\.0\.1)/.test(base))throw new Error('local only');
const photosDir=process.env.UX_PHOTOS||'/tmp/tb-ux/photos';
async function call(n,path,method='GET',body,type='application/json'){
  const c=sessionCookie(n);
  const res=await fetch(base+path,{method,headers:{cookie:`${c.name}=${c.value}`,origin:base,...(body?{'content-type':type}:{})},body:body&&type==='application/json'?JSON.stringify(body):body});
  const json=await res.json();if(!res.ok)throw new Error(`${method} ${path} ${res.status} ${JSON.stringify(json)}`);return json;
}
const names={1:'Patrick',2:'Mia',3:'Jonas',4:'Sara'};
for(const n of [1,2,3,4])await call(n,'/api/me','PATCH',{nickname:names[n]});
const group=await call(1,'/api/groups','POST',{name:'Friday Food Club'});
const detail=await call(1,`/api/groups/${group.id}`);
for(const n of [2,3,4])await call(n,'/api/groups/join','POST',{code:detail.inviteCode});
const photos=readdirSync(photosDir).sort((a,b)=>Number(a.replace(/\D/g,''))-Number(b.replace(/\D/g,'')));
const photo=async(n,i)=>(await call(n,`/api/photos?groupId=${group.id}`,'POST',readFileSync(`${photosDir}/${photos[i%photos.length]}`),'image/jpeg')).id;
// [photoIndex, name, brand, type, kind, scores by user]
const plan=[
  [0,'Smash burger','Munchies','Burgers','Food',{1:8.5,2:9,3:7.5,4:8}],
  [1,'Margherita','Villa Paradiso','Pizza','Food',{1:9,2:8.5,3:9.5}],
  [2,'Shoyu ramen','Ramen To Bíru','Noodles','Food',{1:7,2:6,4:6.7}],
  [3,'Flat white','Tim Wendelboe','Coffee','Drink',{1:9.5,3:8,4:9}],
  [4,'Salmon nigiri','Alex Sushi','Sushi','Food',{1:8,3:7}],
  [5,'Butter croissant','Åpent Bakeri','Pastries','Food',{1:8,2:9,3:8.5,4:7.5}],
  [6,'Iced latte','Starbucks','Coffee','Drink',{1:5,2:6.5,4:4}],
  [7,'Carnitas tacos','Taco Republica','Tacos','Food',{1:7.5,3:9}],
  [0,'Double cheese','Burger King','Burgers','Food',{2:4,3:5.5,4:3}],
  [1,'Pepperoni','Dolly Dimple\'s','Pizza','Food',{4:6}],
  // Energy drinks: one flavour in both sugar versions, one sugar-free only, so the toggle has a sibling and a gap.
  [8,'Original','Red Bull','Energy drinks','Drink',{1:7,2:6.5,3:7.5},null],
  [8,'Original','Red Bull','Energy drinks','Drink',{1:6,4:5.5},'Sugarfree'],
  [8,'Ultra White','Monster','Energy drinks','Drink',{1:8.5,2:9},'Sugarfree'],
  [8,'Mango Loco','Monster','Energy drinks','Drink',{3:8},null],
];
const notes=['Crispy edges, would go back.','Too sweet for me.','Best in town honestly.',null,'Solid but pricey.',null];
let k=0;
for(const [pi,name,brand,type,kind,scores,variant=null] of plan){
  let itemId;
  for(const [n,score] of Object.entries(scores)){
    const photoId=await photo(Number(n),pi);
    const tastedAt=new Date(Date.now()-(40-k)*86400000*0.7).toISOString();
    const r=await call(Number(n),'/api/ratings','POST',itemId?{groupId:group.id,itemId,score,note:notes[k%notes.length],photoId,photoIds:[photoId],tastedAt}:{groupId:group.id,name,brand,variant,type,broadCategory:kind,score,note:notes[k%notes.length],photoId,photoIds:[photoId],tastedAt});
    itemId=r.itemId;k++;
  }
}
console.log(JSON.stringify({groupId:group.id,ratings:k}));
