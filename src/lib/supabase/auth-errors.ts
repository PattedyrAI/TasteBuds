import {isAuthRetryableFetchError,type AuthError} from '@supabase/supabase-js';

export function authTemporarilyUnavailable(error:AuthError|null):boolean {
  return Boolean(error&&(isAuthRetryableFetchError(error)||error.status===429||(error.status??0)>=500));
}
