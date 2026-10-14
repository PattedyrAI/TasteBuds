/** Matthew mode highlights Matthew's ratings, matched by "Matthew" anywhere in the display name. */
export function isMatthew(displayName:string|null|undefined){
  return !!displayName&&/matthew/i.test(displayName);
}
