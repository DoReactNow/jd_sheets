//! Verifies collab tokens issued by the app (Decision 10). HS256, issuer and audience checked,
//! expiry checked against the injected clock with a leeway, the role must be known, and the
//! connection must come from the IP the token names. Shared fixtures in contracts/collab-token/.
use std::net::IpAddr;

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::Deserialize;

use crate::clock::Clock;
use crate::config::Limits;
use crate::ip::normalize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TokenRole {
    Editor,
    Commenter,
    Viewer,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct CollabClaims {
    pub iss: String,
    pub aud: String,
    pub sub: String,
    pub sid: String,
    pub wb: String,
    pub role: TokenRole,
    #[serde(default)]
    pub own: bool,
    pub ip: String,
    pub name: String,
    pub iat: u64,
    pub exp: u64,
    pub jti: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TokenError {
    #[error("malformed or wrongly signed token")]
    Invalid,
    #[error("token expired")]
    Expired,
    #[error("token not valid yet")]
    NotYetValid,
    #[error("connection from another address")]
    IpMismatch,
}

impl TokenError {
    /// The name used in contracts/collab-token/cases.json.
    pub fn as_str(self) -> &'static str {
        match self {
            TokenError::Invalid => "invalid",
            TokenError::Expired => "expired",
            TokenError::NotYetValid => "not_yet_valid",
            TokenError::IpMismatch => "ip_mismatch",
        }
    }
}

pub fn verify(
    token: &str,
    secret: &str,
    limits: &Limits,
    clock: &dyn Clock,
    connection_ip: Option<IpAddr>,
) -> Result<CollabClaims, TokenError> {
    let mut validation = Validation::new(Algorithm::HS256);
    // Expiry is checked below against the injected clock, not the system clock.
    validation.validate_exp = false;
    validation.validate_nbf = false;
    validation.leeway = 0;
    validation.set_issuer(&[limits.token_issuer.as_str()]);
    validation.set_audience(&[limits.token_audience.as_str()]);
    validation.set_required_spec_claims(&["iss", "aud", "sub", "exp", "iat"]);
    let claims = decode::<CollabClaims>(token, &DecodingKey::from_secret(secret.as_bytes()), &validation)
        .map_err(|_| TokenError::Invalid)?
        .claims;

    let now = clock.now_unix();
    let leeway = limits.token_leeway_seconds;
    if claims.exp.saturating_add(leeway) < now {
        return Err(TokenError::Expired);
    }
    if claims.iat > now.saturating_add(leeway) {
        return Err(TokenError::NotYetValid);
    }
    // A token is never valid for longer than the agreed lifetime, whatever exp says.
    if claims.exp.saturating_sub(claims.iat) > limits.token_ttl_seconds {
        return Err(TokenError::Invalid);
    }
    let token_ip = claims
        .ip
        .parse::<IpAddr>()
        .map(normalize)
        .map_err(|_| TokenError::Invalid)?;
    if connection_ip.map(normalize) != Some(token_ip) {
        return Err(TokenError::IpMismatch);
    }
    Ok(claims)
}
