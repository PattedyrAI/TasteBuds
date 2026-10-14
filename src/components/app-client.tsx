'use client';
import {canonicalBrand} from '../domain/brand-identity';
import {canManageGroup} from '../domain/group-roles';
import {RestaurantMap} from './restaurant-map';
import {CategoryFieldFilters} from './category-field-filters';
import {matchesFieldFilters,type FieldFilters} from '../domain/restaurant-filters';
import {DiscoveryActions} from './discovery-actions';
import {BrandPage,PersonalFilters,TasteInsights} from './personal-discovery';
import {categoryChoices,filterPersonalItems,type PersonalFilter} from '../domain/personal-discovery';
import {RatingStatus} from './rating-status';
import {BrandLabel} from './brand-label';
import {browseCategory,matchesBrowseCategory} from '../domain/browse-categories';
import {matchesItemSearch} from '../domain/item-search';
import {useEffect,useRef,useState} from 'react';
import {House,BookOpen,Activity,Plus,Search,LogOut,ArrowUpRight,Users,MapPin,Compass,CircleUser,SlidersHorizontal,X} from 'lucide-react';
import {sectionFor,type Section} from '../domain/category-taxonomy';
import {scoreBands} from '../domain/score-scale';
import type {Bootstrap,GroupDetail,Item,ItemDetail as Detail,FeedEntry,Rating} from '@/lib/contracts';
import {ReviewPhotos,reviewPhotoIds} from './review-photos';
import {Avatar,BrandMark,Modal,Photo,Score,request,date} from './ui';
import {SelectMenu} from './select-menu';
import {RatingForm} from './rating-form';
import {InstallApp} from './install-app';
import {ItemDetail} from './item-detail';
import {GroupSettings} from './group-settings';
import {CollectionHome} from './collection-home';
import {CategoryFilters} from './category-filters';
import {ItemCard} from './item-card';
import {FriendComparePicker,friendScoreFor,useFriendScores} from './friend-compare';
import {GroupPodium} from './group-podium';
import {isMatthew} from '../domain/matthew';
import {People} from './people';
import {AccountSettings,NicknameOnboarding} from './nickname';
type Tab='home'|'collection'|'feed'|'stats'|'settings'|'people'|'mine';
type GroupLoad={groupId:string;revision:number;status:'loading'|'ready'|'error';group:GroupDetail|null;items:Item[];feed:FeedEntry[]};
async function allItems(groupId:string){const result:Item[]=[];for(let offset=0;;offset+=200){const page=await request<Item[]>(`/api/groups/${groupId}/items?limit=200&offset=${offset}`);result.push(...page);if(page.length<200)return result;}}
export function AppClient(){
  const [boot,setBoot]=useState<Bootstrap|null>(null),[groupId,setGroupId]=useState(''),[groupLoad,setGroupLoad]=useState<GroupLoad|null>(null),[tab,setTab]=useState<Tab>('home');
  const [search,setSearch]=useState(''),[brand,setBrand]=useState(''),[type,setType]=useState<string|null>(''),[sort,setSort]=useState('recent'),[error,setError]=useState(''),[revision,setRevision]=useState(0),[groupsModal,setGroupsModal]=useState(false);
  const [rating,setRating]=useState<{item?:Item;editing?:Rating;rereview?:Rating}|null>(null),[detail,setDetail]=useState<string|null>(null),[notice,setNotice]=useState('');
  const [section,setSection]=useState<Section|''>(''),[filtersOpen,setFiltersOpen]=useState(false);
  const [personalFilter,setPersonalFilter]=useState<PersonalFilter>('all'),[brandView,setBrandView]=useState<string|null>(null);
  const [fieldFilters,setFieldFilters]=useState<FieldFilters>({}),[collectionView,setCollectionView]=useState<'list'|'map'>('list');
  useEffect(()=>{setFieldFilters({});setCollectionView('list');},[type,groupId]);
  const saving=useRef(new Map<string,Promise<boolean>>());
  const [personId,setPersonId]=useState<string|null>(null);
  const personalEdit=useRef<AbortController|null>(null);
  useEffect(()=>()=>personalEdit.current?.abort(),[groupId,tab,personId,revision,rating,detail,groupsModal,brandView]);
  const currentLoad=groupLoad?.groupId===groupId&&groupLoad.revision===revision?groupLoad:null;
  const group=currentLoad?.group||null,items=currentLoad?.items||[],feed=currentLoad?.feed||[];
  // Chips select browse groups ("Pizza & calzones"); a template inside that group still brings its map and field filters.
  const templatesInView=type?(group?.categories??[]).filter(category=>category.name===type||(category.fields.length>0&&browseCategory(category.name)===browseCategory(type))):[];
  const selectedCategory=templatesInView.find(category=>category.name===type)??(templatesInView.length===1?templatesInView[0]:undefined);
  const showCategoryMap=collectionView==='map'&&Boolean(selectedCategory?.fields.some(field=>field.type==='location'));
  const loading=Boolean(groupId)&&(!currentLoad||currentLoad.status==='loading');
  const refresh=()=>setRevision(v=>v+1);
  const [compare,setCompare]=useState<{groupId:string;personId:string}|null>(null);
  // A comparison belongs to one group and one current member; switching either resets it.
  const compareMember=compare&&compare.groupId===groupId?group?.members.find(m=>m.id===compare.personId&&m.id!==boot?.user.id)??null:null;
  const friendScores=useFriendScores(groupId,compareMember?{id:compareMember.id,name:compareMember.displayName}:null,revision);
  const comparePicker=(itemIds:string[])=>group&&boot?<FriendComparePicker members={group.members} viewerId={boot.user.id} value={compareMember?.id??''} onChange={personId=>setCompare(personId?{groupId,personId}:null)} scores={friendScores} itemIds={itemIds}/>:null;
  const nicknameSaved=(user:Bootstrap['user'])=>{const first=boot?.user.nickname===null;setBoot(previous=>previous?{...previous,user}:previous);setNotice(first?`Welcome, ${user.nickname}!`:'Your nickname has been updated.');refresh();};
  const preferencesSaved=(user:Bootstrap['user'])=>{setBoot(previous=>previous?{...previous,user}:previous);setNotice('Your photo preference has been updated.');refresh();};
  const openPerson=(id:string|null)=>{setPersonId(id);setDetail(null);navigateTab('people');};
  async function openPersonalReview(ratingId:string,itemId:string,mode:'edit'|'rereview'){
    personalEdit.current?.abort();const operation=new AbortController();personalEdit.current=operation;
    try{
      const item=await request<Detail>(`/api/items/${itemId}`,'GET',undefined,operation.signal),entry=item.ratings.find(r=>r.id===ratingId);
      if(operation.signal.aborted)return;
      if(!entry||entry.author.id!==boot?.user.id||item.groupId!==groupId)throw new Error('This review is no longer available to edit.');
      setDetail(null);setRating(mode==='edit'?{editing:entry,item}:{rereview:entry,item});
    }catch(e){if(!operation.signal.aborted)throw e;}
    finally{if(personalEdit.current===operation)personalEdit.current=null;}
  }
  const editPersonalReview=(ratingId:string,itemId:string)=>openPersonalReview(ratingId,itemId,'edit');
  const rereviewPersonalReview=(ratingId:string,itemId:string)=>openPersonalReview(ratingId,itemId,'rereview');
  // Views live in the URL so Back moves between them and a reload keeps your place.
  const navigateTab=(next:Tab)=>{setBrandView(null);setTab(next);const fromDialog=!!window.history.state?.tbModal;if(tabFromUrl()!==next||fromDialog){const url=new URL(window.location.href);if(next==='home')url.searchParams.delete('view');else url.searchParams.set('view',next);url.searchParams.delete('item');/* Leaving a dialog for a view replaces the dialog's entry, so Back doesn't land on a closed dialog. */window.history[fromDialog?'replaceState':'pushState']({tbView:next},'',url);}window.scrollTo({top:0});};
  useEffect(()=>{setTab(tabFromUrl());const sync=(event:PopStateEvent)=>{if(!event.state?.tbModal)setTab(tabFromUrl());};window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
  const openBrand=(name:string)=>{setDetail(null);setRating(null);navigateTab('collection');setBrandView(name);};
  async function saveItem(item:Item):Promise<boolean>{
    const pending=saving.current.get(item.id);if(pending)return pending;
    const operation=request<{saved:boolean}>(`/api/items/${item.id}/save`,item.saved?'DELETE':'POST',{}).then(result=>{
      setGroupLoad(current=>current?.groupId===item.groupId?{...current,items:current.items.map(i=>i.id===item.id?{...i,saved:result.saved}:i)}:current);return result.saved;
    });
    saving.current.set(item.id,operation);try{return await operation;}finally{saving.current.delete(item.id);}
  }
  const switchGroup=(id:string)=>{setCompare(null);setSection('');setGroupId(id);setBrandView(null);setPersonalFilter('all');setSearch('');setType('');setBrand('');setDetail(null);setRating(null);setPersonId(null);};
  useEffect(()=>{let active=true;request<Bootstrap>('/api/bootstrap').then(v=>{if(!active)return;setBoot(v);setGroupId(previous=>v.groups.some(g=>g.id===previous)?previous:v.groups[0]?.id||'');}).catch(e=>{if(active){setError(e.message);}});return()=>{active=false;};},[revision]);
  useEffect(()=>{if(!groupId){setGroupLoad(null);return;}let active=true;const empty:GroupLoad={groupId,revision,status:'loading',group:null,items:[],feed:[]};setGroupLoad(empty);setError('');Promise.all([request<GroupDetail>(`/api/groups/${groupId}`),allItems(groupId),request<FeedEntry[]>(`/api/groups/${groupId}/feed?limit=100`)]).then(([g,i,f])=>{if(active)setGroupLoad({groupId,revision,status:'ready',group:g,items:i,feed:f});}).catch(e=>{if(active){setGroupLoad({...empty,status:'error'});setError(e.message);}});return()=>{active=false;};},[groupId,revision]);
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get('item');if(!id)return;let active=true;void request<Item>(`/api/items/${encodeURIComponent(id)}`).then(item=>{if(active){setGroupId(item.groupId);setDetail(item.id);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  const filtered=filterPersonalItems(items,personalFilter).filter(i=>(!brand||canonicalBrand(i.brand)===canonicalBrand(brand))&&(!section||sectionFor(i.type,i.broadCategory)===section)&&(group?.categories?.some(c=>c.name===type)?i.type===type:matchesBrowseCategory(i.type,type))&&matchesItemSearch(i,search)&&matchesFieldFilters(i,fieldFilters)).sort((a,b)=>sort==='score'?(b.average??-1)-(a.average??-1):sort==='name'?a.name.localeCompare(b.name):sort==='most-rated'?b.tastingCount-a.tastingCount:new Date(b.lastRatedAt||0).getTime()-new Date(a.lastRatedAt||0).getTime());
  const brands=[...new Set(items.flatMap(i=>canonicalBrand(i.brand)?[canonicalBrand(i.brand)!]:[]))].sort();
  const groupOptions=[...boot?.groups.map(g=>({value:g.id,label:g.name}))??[],{value:NEW_GROUP,label:'+ Create or join a group',alwaysVisible:true}];
  const chooseGroup=(id:string)=>id===NEW_GROUP?setGroupsModal(true):switchGroup(id);
  const filterCount=(brand?1:0)+(sort!=='recent'?1:0)+(personalFilter!=='all'?1:0)+(compareMember?1:0);
  const clearFilters=()=>{setSearch('');setBrand('');setType('');setSection('');setPersonalFilter('all');setSort('recent');setCompare(null);};
  const primary=primaryOf(tab);
  if(!boot)return <main className="loading-screen"><span className="wordmark"><BrandMark/></span>{error?<><p className="error">{error}</p><button className="button primary" onClick={refresh}>Try again</button></>:<p>Opening your collection…</p>}</main>;
  if(boot.user.nickname===null)return <NicknameOnboarding user={boot.user} saved={nicknameSaved}/>;
  const groupName=group?.name||boot.groups.find(g=>g.id===groupId)?.name||'';
  const subnav=primary==='group'?[{id:'feed' as Tab,label:'Activity'},{id:'stats' as Tab,label:'Insights'},{id:'people' as Tab,label:'People'}]:primary==='you'?[{id:'mine' as Tab,label:'My ratings'},{id:'settings' as Tab,label:'Settings'}]:null;
  const titles:Record<Tab,string>={home:groupName||'Home',collection:'Explore',feed:'Group',stats:'Group',people:'Group',mine:'You',settings:'You'};
  const rateButton=(className:string)=><button className={className} disabled={!group||loading} onClick={()=>setRating({})}><Plus size={22}/><span>Rate</span></button>;
  return <DiscoveryActions.Provider value={{openBrand,saveItem,savedItems:Object.fromEntries(items.map(item=>[item.id,item.saved===true]))}}><div className="app-shell"><aside className="sidebar"><a className="wordmark" href="/app"><BrandMark/></a><div className="group-picker"><SelectMenu label="Your group" value={groupId} onChange={chooseGroup} options={groupOptions} placeholder="No groups yet"/></div>{group&&<button className="button primary sidebar-rate" disabled={loading} onClick={()=>setRating({})}><Plus size={19}/>Rate something</button>}<nav aria-label="Main navigation">{primaryNav.map(n=><button key={n.id} aria-current={primary===n.id?'page':undefined} className={primary===n.id?'active':''} onClick={()=>navigateTab(n.tab)}><n.icon size={20}/>{n.label}</button>)}</nav><span className="matthew-claw" aria-hidden="true"/><div className="sidebar-bottom"><Avatar name={boot.user.displayName} url={boot.user.avatarUrl}/><span>{boot.user.displayName}</span><button className="icon-button" aria-label="Sign out" onClick={()=>void request('/auth/logout','POST',{}).then(()=>window.location.href='/').catch(e=>setError(e.message))}><LogOut size={18}/></button></div></aside>
  <main className="workspace" data-view={tab}><header className="mobile-header"><SelectMenu label="Your group" value={groupId} onChange={chooseGroup} options={groupOptions} placeholder="Choose a group"/><button className="avatar-button" aria-label="You: ratings and settings" onClick={()=>navigateTab('mine')}><Avatar name={boot.user.displayName} url={boot.user.avatarUrl}/></button></header>
    {error&&<div className="error" role="alert">{error}<button onClick={refresh}>Try again</button></div>}{notice&&<div className="success toast" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss notification"><X size={16}/></button></div>}
    {tab==='home'&&<InstallApp invitation/>}
    {!brandView&&<header className="page-header" key={primary}><div><h1>{titles[tab]}</h1>{tab==='home'&&group&&<p className="page-meta"><button className="text-button" onClick={()=>openPerson(null)}><Users size={15}/>{group.memberCount} {group.memberCount===1?'person':'people'}</button><span>{group.stats.itemCount} things · {group.stats.tastingCount} tastings</span></p>}</div></header>}
    {subnav&&!brandView&&<div className="subnav segmented-control" role="tablist" aria-label={primary==='group'?'Group views':'Your views'}>{subnav.map(v=><button key={v.id} role="tab" aria-selected={tab===v.id} className={tab===v.id?'selected':''} onClick={()=>navigateTab(v.id)}>{v.label}</button>)}</div>}
    {tab==='settings'&&<AccountSettings user={boot.user} saved={nicknameSaved} preferencesSaved={preferencesSaved}/>}
    {!groupId&&tab==='settings'?null:!groupId?<section className="onboarding"><div className="onboarding-symbol"><Users size={44}/></div><h1>Good taste starts<br/>with good company.</h1><p>Create a private group or join your friends with an invite code.</p><button className="button primary" onClick={()=>setGroupsModal(true)}>Find your people <ArrowUpRight size={18}/></button></section>:<>
    {loading?<div className="skeleton-grid" role="status" aria-label="Loading your group"><span/><span/><span/><span/></div>:!group?null:brandView?<BrandPage key={`${groupId}-${brandView}`} name={brandView} items={items} open={setDetail} back={()=>setBrandView(null)} friendScores={friendScores} comparePicker={comparePicker}/>
    :tab==='home'?<CollectionHome key={groupId} items={items} feed={feed} name={boot.user.nickname||''} browse={(value,s)=>{setSection(s??sectionFor(value)??'');setType(value);setPersonalFilter('all');setBrand('');setSearch('');navigateTab('collection');}} open={setDetail} add={()=>setRating({})} showFeed={()=>navigateTab('feed')} showInsights={()=>navigateTab('stats')} showSaved={()=>{clearFilters();setPersonalFilter('saved');navigateTab('collection');}}/>
    :tab==='collection'?<>{!showCategoryMap&&<div className="explore-tools"><label className="search"><Search size={19}/><input type="search" aria-label="Search collection" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search items, brands, places"/>{search&&<button type="button" className="icon-button" aria-label="Clear search" onClick={()=>setSearch('')}><X size={16}/></button>}</label><button type="button" className={`button secondary filter-button${filterCount?' active':''}`} onClick={()=>setFiltersOpen(true)} aria-label={`Sort and filter${filterCount?`, ${filterCount} active`:''}`}><SlidersHorizontal size={18}/><span>Sort &amp; filter</span>{filterCount>0&&<span className="badge">{filterCount}</span>}</button></div>}
    <CategoryFilters key={groupId} items={items} section={section} onSection={setSection} value={type} onChange={setType}/>
    {selectedCategory&&selectedCategory.fields.length>0&&<div className="collection-template-filters">{selectedCategory.fields.some(field=>field.type==='location')&&<div className="segmented-control" role="group" aria-label="View"><button aria-pressed={collectionView==='list'} className={collectionView==='list'?'selected':''} onClick={()=>setCollectionView('list')}><BookOpen size={16}/>List</button><button aria-pressed={collectionView==='map'} className={collectionView==='map'?'selected':''} onClick={()=>setCollectionView('map')}><MapPin size={16}/>Map</button></div>}{!showCategoryMap&&<CategoryFieldFilters category={selectedCategory} items={items} value={fieldFilters} onChange={setFieldFilters}/>}</div>}
    {!showCategoryMap&&filterCount>0&&<div className="active-filters"><span>{[personalFilter==='untried'?'Untried by you':personalFilter==='saved'?'Want to try':null,brand||null,sort!=='recent'?sortLabels[sort]:null,compareMember?`Comparing with ${compareMember.displayName}`:null].filter(Boolean).join(' · ')}</span><button className="text-button" onClick={clearFilters}>Clear</button></div>}
    {showCategoryMap&&selectedCategory?<RestaurantMap key={`${groupId}-${selectedCategory.id}`} groupId={groupId} category={selectedCategory} open={setDetail}/>:filtered.length===0?<div className="empty-state"><BookOpen size={36}/><h2>{items.length?'Nothing matches.':'Your next discovery belongs here.'}</h2><p>{items.length?'Try another search or clear the filters.':'Snap a photo and add your first rating to start the collection.'}</p><button className="button secondary" onClick={()=>items.length?clearFilters():setRating({})}>{items.length?'Clear filters':'Rate something'}</button></div>:<><p className="result-count" role="status">{filtered.length} {filtered.length===1?'item':'items'}</p><div className="item-grid">{filtered.map(i=><ItemCard key={i.id} item={i} open={setDetail} friend={friendScoreFor(friendScores,i.id)}/>)}</div></>}</>
    :tab==='feed'?<div className="feed-list">{feed.length===0?<div className="empty-state"><Activity size={36}/><h2>The conversation starts with a rating.</h2><p>Try something and tell the group what you think.</p></div>:feed.map(r=><article className="feed-card" key={r.id} data-matthew={isMatthew(r.author.displayName)||undefined}><button type="button" className="card-open-hit" aria-label={`Open ${r.itemName}`} onClick={()=>setDetail(r.itemId)}/><header className="feed-head"><button type="button" className="feed-person" onClick={()=>openPerson(r.author.id)} aria-label={`See ${r.author.displayName}’s ratings`}><Avatar name={r.author.displayName} url={r.author.avatarUrl}/></button><p><strong>{r.author.displayName}</strong> {r.isRereview?'rated again':'rated'} <strong>{r.itemName}</strong><small>{[r.brand,date(r.tastedAt)].filter(Boolean).join(' · ')}</small></p><Score value={r.score} words/></header><RatingStatus rating={r}/>{r.note&&<p className="note">{r.note}</p>}{r.photoId&&<ReviewPhotos ids={reviewPhotoIds(r)} name={r.itemName} compact/>}</article>)}</div>
    :(tab==='people'||tab==='mine')?<People key={`${groupId}-${tab}-${revision}`} groupId={groupId} personId={tab==='mine'?boot.user.id:personId} select={openPerson} open={setDetail} viewerId={boot.user.id} edit={editPersonalReview} rereview={rereviewPersonalReview} changed={refresh}/>
    :tab==='stats'?<><div className="stat-strip"><div><strong>{group?.stats.itemCount||0}</strong><span>things tried</span></div><div><strong>{group?.stats.tastingCount||0}</strong><span>tastings</span></div><div><strong>{group?.stats.activeMembers||0}</strong><span>people rating</span></div></div><ScoreGuide/><GroupPodium key={groupId} items={items} open={setDetail} browse={()=>{clearFilters();navigateTab('collection');}}/><TasteInsights key={`${groupId}-${revision}`} groupId={groupId} open={setDetail} person={openPerson}/><div className="stats-columns"><section><h2>Coming back for more</h2><p className="muted">The items with the most tastings.</p><div className="repeat-list">{[...items].sort((a,b)=>b.tastingCount-a.tastingCount).slice(0,10).map(i=><button className="ranking" key={i.id} onClick={()=>setDetail(i.id)}><Photo id={i.photoId} name={i.name}/><div className="ranking-copy"><strong>{i.name}</strong><BrandLabel brand={i.brand}/>{!i.brand&&i.type&&<small>{i.type}</small>}</div><span className="tasting-count">{i.tastingCount}<small>{i.tastingCount===1?'tasting':'tastings'}</small></span></button>)}</div></section></div></>
    :group&&<GroupSettings key={`${group.id}-${revision}`} group={group} user={boot.user} changed={refresh}/>}</>}
  </main><nav className="bottom-nav" aria-label="Mobile navigation">{primaryNav.slice(0,2).map(n=><button key={n.id} aria-current={primary===n.id?'page':undefined} className={primary===n.id?'active':''} onClick={()=>navigateTab(n.tab)}><n.icon size={22}/><span>{n.label}</span></button>)}{group?rateButton('rate-tab'):<span/>}{primaryNav.slice(2).map(n=><button key={n.id} aria-current={primary===n.id?'page':undefined} className={primary===n.id?'active':''} onClick={()=>navigateTab(n.tab)}><n.icon size={22}/><span>{n.label}</span></button>)}</nav>
  {filtersOpen&&<Modal className="sheet filters-sheet" title="Sort & filter" close={()=>setFiltersOpen(false)} footer={<div className="button-row"><button className="button secondary" onClick={clearFilters}>Reset</button><button className="button primary grow" onClick={()=>setFiltersOpen(false)}>Show {filtered.length} {filtered.length===1?'item':'items'}</button></div>}>
    <fieldset className="filter-group"><legend>Sort by</legend><div className="chip-row">{Object.entries(sortLabels).map(([value,label])=><button type="button" key={value} aria-pressed={sort===value} className={`chip${sort===value?' selected':''}`} onClick={()=>setSort(value)}>{label}</button>)}</div></fieldset>
    <fieldset className="filter-group"><legend>Show</legend><PersonalFilters items={items} value={personalFilter} onChange={setPersonalFilter}/></fieldset>
    <div className="filter-group"><span className="field-label">Brand or place</span><SelectMenu label="Filter by brand or place" value={brand} onChange={setBrand} searchable options={[{value:'',label:'Any brand or place'},...brands.map(v=>({value:v,label:v}))]}/></div>
    <div className="filter-group"><span className="field-label">Compare scores with</span>{comparePicker(filtered.map(i=>i.id))}</div>
  </Modal>}
  {groupsModal&&<GroupsModal close={()=>setGroupsModal(false)} saved={id=>{switchGroup(id);setGroupsModal(false);refresh();}}/>}
  {rating&&groupId&&<RatingForm canManageCategories={canManageGroup(group?.role)} categoryTemplates={group?.categories||[]} aiEnabled={boot.user.aiEnabled} groupId={rating.item?.groupId||groupId} item={rating.item} editing={rating.editing} rereview={rating.rereview} categories={[...new Set([...items.flatMap(i=>i.type?[i.type]:[]),...(group?.categories||[]).map(c=>c.name)])]} items={items} close={()=>{setRating(null);refresh();}} saved={()=>{setRating(null);setNotice('Rating saved.');refresh();}}/>}
  {detail&&!rating&&<ItemDetail key={`${detail}-${revision}`} id={detail} user={boot.user} owner={canManageGroup(group?.role)} person={openPerson} categories={[...new Set([...items.flatMap(i=>i.type?[i.type]:[]),...(group?.categories||[]).map(c=>c.name)])]} rereview={(rereview,item)=>{setGroupId(item.groupId);setRating({rereview,item});}} close={()=>setDetail(null)} rate={item=>{setGroupId(item.groupId);setRating({item});}} edit={(editing,item)=>{setGroupId(item.groupId);setRating({editing,item});}} changed={refresh}/>}
  </div></DiscoveryActions.Provider>;
}
const NEW_GROUP='__new_group__';
const sortLabels:Record<string,string>={recent:'Recently tried',score:'Highest rated',name:'Name A–Z','most-rated':'Most tried'};
type Primary='home'|'explore'|'group'|'you';
const primaryNav:{id:Primary;tab:Tab;label:string;icon:typeof House}[]=[{id:'home',tab:'home',label:'Home',icon:House},{id:'explore',tab:'collection',label:'Explore',icon:Compass},{id:'group',tab:'feed',label:'Group',icon:Users},{id:'you',tab:'mine',label:'You',icon:CircleUser}];
function primaryOf(tab:Tab):Primary{return tab==='home'?'home':tab==='collection'?'explore':tab==='feed'||tab==='stats'||tab==='people'?'group':'you';}
const tabs:Tab[]=['home','collection','feed','stats','settings','people','mine'];
const tabFromUrl=():Tab=>{if(typeof window==='undefined')return 'home';const value=new URLSearchParams(window.location.search).get('view');return tabs.includes(value as Tab)?value as Tab:'home';};
/** The score bands in one line, so the numbers everywhere else read the same way. */
function ScoreGuide(){
  return <section className="score-guide" aria-label="How to read scores"><h2>How to read scores</h2><ol>{scoreBands.map((b,i)=><li key={b.tier} data-tier={b.tier}><strong>{b.min}{scoreBands[i+1]?`–${(scoreBands[i+1].min-.1).toFixed(1).replace('.0','')}`:'–10'}</strong><span>{b.label}</span></li>)}</ol><p className="muted">The group score is the average of each person’s latest score, so trying something again replaces your old score instead of counting twice.</p></section>;
}
function GroupsModal({close,saved}:{close:()=>void;saved:(id:string)=>void}){
  const [mode,setMode]=useState<'create'|'join'>('create'),[value,setValue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <Modal title="Find your people" close={close}><div className="segmented"><button className={mode==='create'?'selected':''} onClick={()=>{setMode('create');setValue('');}}>Create a group</button><button className={mode==='join'?'selected':''} onClick={()=>{setMode('join');setValue('');}}>Join a group</button></div><form className="rating-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const g=await request<{id:string}>(mode==='create'?'/api/groups':'/api/groups/join','POST',mode==='create'?{name:value}:{code:value});saved(g.id);}catch(e){setError(e instanceof Error?e.message:'Could not continue.');setBusy(false);}}}><p className="muted">{mode==='create'?'A private space for friends, family, or your next tasting club.':'Ask a group owner for their invite code.'}</p><label>{mode==='create'?'Group name':'Invite code'}<input required autoFocus maxLength={120} value={value} onChange={e=>setValue(e.target.value)} placeholder={mode==='create'?'The usual suspects':'Paste your invite code'}/></label>{error&&<p className="error" role="alert">{error}</p>}<button className="button primary full" disabled={busy}>{busy?'One moment…':mode==='create'?'Create group':'Join group'}</button></form></Modal>;
}
