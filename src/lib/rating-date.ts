/** Calendar controls use the viewer's date; server records retain full instants. */
export function ratingDateValue(value:string|Date=new Date()):string{
  const date=value instanceof Date?value:new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function ratingTimestamp(value:string,original?:string):string{
  if(original&&ratingDateValue(original)===value)return original;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Choose a valid date.');
  const now=new Date();
  if(!original&&ratingDateValue(now)===value)return now.toISOString();
  const date=new Date(`${value}T12:00:00`);
  if(!Number.isFinite(date.getTime())||ratingDateValue(date)!==value)throw new Error('Choose a valid date.');
  return date.toISOString();
}
