const ROLES = Object.freeze({
  NEW_MEMBER: 'new_member',
  MEMBER: 'member',
  DEVELOPER: 'developer',
  MODERATOR: 'moderator',
  ADMINISTRATOR: 'administrator',
  APP_OWNER: 'app_owner'
});

const ROLE_LABELS = Object.freeze({
  [ROLES.NEW_MEMBER]: 'New Member',
  [ROLES.MEMBER]: 'Member',
  [ROLES.DEVELOPER]: 'Developer',
  [ROLES.MODERATOR]: 'Moderator',
  [ROLES.ADMINISTRATOR]: 'Administrator',
  [ROLES.APP_OWNER]: 'App Owner'
});

const ASSIGNABLE_ROLES = new Set([
  ROLES.NEW_MEMBER,
  ROLES.MEMBER,
  ROLES.DEVELOPER,
  ROLES.MODERATOR,
  ROLES.ADMINISTRATOR
]);

function normalizeRole(value, fallback = ROLES.MEMBER) {
  return Object.hasOwn(ROLE_LABELS, value) && value !== ROLES.APP_OWNER ? value : fallback;
}

function can(user, permission, ownerUserId) {
  if (!user) return false;
  const role = user.id === ownerUserId ? ROLES.APP_OWNER : normalizeRole(user.role);
  const permissions = {
    complete_onboarding: new Set([ROLES.NEW_MEMBER]),
    manage_reports: new Set([ROLES.MODERATOR, ROLES.ADMINISTRATOR, ROLES.APP_OWNER]),
    moderate_content: new Set([ROLES.MODERATOR, ROLES.ADMINISTRATOR, ROLES.APP_OWNER]),
    manage_platform_settings: new Set([ROLES.ADMINISTRATOR, ROLES.APP_OWNER]),
    manage_roles: new Set([ROLES.APP_OWNER])
  };
  return permissions[permission]?.has(role) || false;
}

module.exports = { ROLES, ROLE_LABELS, ASSIGNABLE_ROLES, normalizeRole, can };
