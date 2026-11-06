// Shapes shared by the identity API and its screens (browser-safe: types only).
export interface AdminUserDto {
  id: string;
  email: string;
  displayName: string;
  status: string;
  roleKey: string | null;
  roleName: string | null;
  signupSource: string;
  rejectedBefore: boolean;
  mustChangePassword: boolean;
  lastSignInAt: string | null;
  createdAt: string;
}
