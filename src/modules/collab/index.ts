// Public API of the collab module. Phase 0: the token contract with the Rust service.
// Phase 3 adds the token route, the internal snapshot route and the access-changed push.
export {
  collabClaims,
  issueCollabToken,
  tokenRoleOf,
  type CollabClaims,
  type CollabTokenInput,
  type TokenRole,
} from "./token";
