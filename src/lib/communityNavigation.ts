/**
 * Sidebar-only navigation. Donate/Request remain fully available through the
 * dashboard actions, and notifications live in the header bell, so none of
 * those three entries belong in the community sidebar.
 */
export const COMMUNITY_SIDEBAR_KEYS = [
  "overview",
  "activities",
  "settings",
] as const;

export type CommunitySidebarKey = (typeof COMMUNITY_SIDEBAR_KEYS)[number];

export const COMMUNITY_HIDDEN_SECTION_KEYS = [
  "donate",
  "request",
  "notifications",
  "profile",
] as const;
