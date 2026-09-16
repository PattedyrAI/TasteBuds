export { ServiceError, requireMembership } from './services/common';
export { updateNickname, updatePreferences } from './services/users';
export { ensureUser, bootstrap, createGroup, joinGroup, getGroup, updateGroup, rotateInvite, removeMember } from './services/groups';
export { listItems, getItem, getFeed, updateItem, saveItem } from './services/items';
export { listPeople, getPersonRatings } from './services/people';
export { createRating, updateRating, deleteRating, addComment, deleteComment, updateComment } from './services/ratings';
export { getTasteInsights } from './services/discovery';
