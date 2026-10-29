import {ChevronDown} from 'lucide-react';
/** One expandable settings row. The header always shows its current state, so it can stay closed. */
export function Disclosure({title,summary,children,nested=false,defaultOpen=false}:{title:React.ReactNode;summary?:React.ReactNode;children:React.ReactNode;nested?:boolean;defaultOpen?:boolean}){
  return <details className={nested?'disclosure nested':'disclosure'} open={defaultOpen||undefined}>
    <summary><span className="disclosure-title">{title}</span>{summary!=null&&<span className="disclosure-summary">{summary}</span>}<ChevronDown className="disclosure-caret" size={18} aria-hidden="true"/></summary>
    <div className="disclosure-body">{children}</div>
  </details>;
}
