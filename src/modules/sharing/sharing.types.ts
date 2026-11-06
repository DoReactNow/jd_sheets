// What the sharing API answers.
export type ShareRoleCode = "EDITOR" | "COMMENTER" | "VIEWER";

export interface GrantDto {
  id: string;
  role: ShareRoleCode;
  target:
    | { type: "user"; id: string; email: string; displayName: string; active: boolean }
    | { type: "group"; id: string; name: string; memberCount: number };
  createdAt: string;
}

export interface SharingDto {
  workbookId: string;
  owner: { id: string; email: string; displayName: string } | null;
  grants: GrantDto[];
  linkRole: ShareRoleCode | null;
  allowDownloadForReaders: boolean;
}

export interface ShareTargetsDto {
  users: Array<{ id: string; email: string; displayName: string }>;
  groups: Array<{ id: string; name: string; memberCount: number }>;
}
