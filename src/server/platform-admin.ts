/** Server-only: compare the canonical account resolved from verified Discord identity.
 * An unset or malformed setting grants nobody platform access. Never use nicknames.
 */
export function isPlatformAdmin(userId:string):boolean{
  const configured=process.env.PLATFORM_ADMIN_USER_ID?.trim();
  return Boolean(configured&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(configured)&&configured.toLowerCase()===userId.toLowerCase());
}
