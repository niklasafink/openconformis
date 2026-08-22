export const applicationRoles = ["owner", "admin", "analyst", "reviewer", "viewer"] as const;

export type ApplicationRole = (typeof applicationRoles)[number];
