'use client';
import {useState} from 'react';
import {Dices, ArrowUpRight} from 'lucide-react';
import type {Item} from '@/lib/contracts';
import {pickSurprise, surpriseCandidates, SURPRISE_MIN_SCORE} from '../domain/surprise';
import {Modal, Photo, Score} from './ui';

/** Picks from the list the person is looking at, so category, search and filters all apply. */
export function SurpriseMe({items, open}: {items: Item[]; open: (id: string) => void}) {
  const candidates = surpriseCandidates(items);
  const [picked, setPicked] = useState<Item | null>(null);
  const roll = (previous: string | null = null) => setPicked(pickSurprise(candidates, previous));
  const none = candidates.length === 0;
  return <>
    <button type="button" className="button secondary surprise-button" disabled={none} onClick={() => roll()}
      title={none ? `Nothing here you haven’t tried with a group score of ${SURPRISE_MIN_SCORE}+` : undefined}>
      <Dices size={17}/>Surprise me</button>
    {picked && <Modal className="surprise-modal" title="Try this next" subtitle={`Something you haven’t rated, and the group scores ${SURPRISE_MIN_SCORE}+.`} close={() => setPicked(null)}
      footer={<div className="button-row">
        <button type="button" className="button secondary" disabled={candidates.length < 2} onClick={() => roll(picked.id)}><Dices size={17}/>Another one</button>
        <button type="button" className="button primary grow" onClick={() => { const id = picked.id; setPicked(null); open(id); }}>Open <ArrowUpRight size={17}/></button>
      </div>}>
      <div className="surprise-pick">
        <Photo id={picked.photoId} name={picked.name}/>
        <div><strong>{picked.name}</strong><span className="muted">{[picked.brand, picked.type].filter(Boolean).join(' · ')}</span>
          <span className="surprise-score"><Score value={picked.average} words/><small>{picked.raterCount} {picked.raterCount === 1 ? 'rater' : 'raters'}</small></span></div>
      </div>
      <p className="hint" role="status">{candidates.length} {candidates.length === 1 ? 'pick' : 'picks'} in this view.</p>
    </Modal>}
  </>;
}
