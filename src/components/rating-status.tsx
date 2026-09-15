import {RotateCcw} from 'lucide-react';
export function RatingStatus({rating}:{rating:{isRereview?:boolean;countsTowardAverage?:boolean}}){
 if(rating.isRereview===undefined&&rating.countsTowardAverage===undefined)return null;
 return <span className="rating-status">{rating.isRereview&&<span className="rereview-badge"><RotateCcw size={12} aria-hidden="true"/> REREVIEW</span>}{rating.countsTowardAverage!==undefined&&<span className="rating-count-status">{rating.countsTowardAverage?'Latest rating · counts toward average':'Not counted in the average'}</span>}</span>;
}
