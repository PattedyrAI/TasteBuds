import {RotateCcw} from 'lucide-react';
export function RatingStatus({rating}:{rating:{isRereview?:boolean;countsTowardAverage?:boolean}}){
 // The latest score is the normal case; only say something when a rating is a repeat or no longer counts.
 if(!rating.isRereview&&rating.countsTowardAverage!==false)return null;
 return <span className="rating-status">{rating.isRereview&&<span className="rereview-badge"><RotateCcw size={12} aria-hidden="true"/> Rated again</span>}{rating.countsTowardAverage===false&&<span className="rating-count-status">Older score · replaced by a newer one</span>}</span>;
}
