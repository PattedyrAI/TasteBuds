export type GroupRole='owner'|'admin'|'member';
export function canManageGroup(role:GroupRole|undefined){return role==='owner'||role==='admin';}
