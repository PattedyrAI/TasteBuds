/** Matthew mode highlights Matthew's ratings. Matches "Matthew" anywhere in a name, or "Matt" as a whole word. */
export function isMatthew(displayName:string|null|undefined){
  return !!displayName&&/matthew|\bmatt\b/i.test(displayName);
}
