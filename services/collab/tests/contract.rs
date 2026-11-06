//! Contracts shared with the app (contracts/): collab tokens (P0-TOKEN-01..08), client IP,
//! error codes (P0-RUST-02) and the shared limits (P0-RUST-03).
use std::net::IpAddr;
use std::path::PathBuf;

use jd_collab::clock::FixedClock;
use jd_collab::config::Limits;
use jd_collab::error::ErrorCode;
use jd_collab::ip::client_ip;
use jd_collab::token::verify;
use serde::Deserialize;

fn contract(file: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../contracts")
        .join(file);
    std::fs::read_to_string(&path).unwrap_or_else(|e| format!("missing {}: {e}", path.display()))
}

#[derive(Deserialize)]
struct TokenFixtures {
    secret: String,
    #[serde(rename = "nowUnix")]
    now_unix: u64,
    cases: Vec<TokenCase>,
}

#[derive(Deserialize)]
struct TokenCase {
    name: String,
    token: String,
    #[serde(rename = "connectionIp")]
    connection_ip: String,
    expect: String,
}

#[test]
fn every_collab_token_case_is_decided_as_the_app_expects() -> Result<(), serde_json::Error> {
    let fixtures: TokenFixtures = serde_json::from_str(&contract("collab-token/cases.json"))?;
    assert!(fixtures.cases.len() >= 10, "the fixture file looks incomplete");
    let clock = FixedClock::at(fixtures.now_unix);
    let limits = Limits::default();
    for case in &fixtures.cases {
        let ip: Option<IpAddr> = case.connection_ip.parse().ok();
        let outcome = match verify(&case.token, &fixtures.secret, &limits, &clock, ip) {
            Ok(_) => "ok",
            Err(error) => error.as_str(),
        };
        assert_eq!(outcome, case.expect, "case: {}", case.name);
    }
    Ok(())
}

#[test]
fn a_valid_token_carries_the_expected_claims() -> Result<(), serde_json::Error> {
    let fixtures: TokenFixtures = serde_json::from_str(&contract("collab-token/cases.json"))?;
    let valid = fixtures.cases.iter().find(|c| c.name == "valid");
    assert!(valid.is_some(), "no valid case in the fixtures");
    let Some(valid) = valid else { return Ok(()) };
    let clock = FixedClock::at(fixtures.now_unix);
    let claims = verify(
        &valid.token,
        &fixtures.secret,
        &Limits::default(),
        &clock,
        valid.connection_ip.parse().ok(),
    );
    let claims = claims.map_err(|e| serde::de::Error::custom(e.to_string()))?;
    assert!(claims.own);
    assert_eq!(claims.name, "Asha");
    assert_eq!(claims.exp - claims.iat, Limits::default().token_ttl_seconds);
    Ok(())
}

#[derive(Deserialize)]
struct IpCase {
    #[serde(rename = "forwardedFor")]
    forwarded_for: Option<String>,
    #[serde(rename = "trustedProxyHops")]
    trusted_proxy_hops: usize,
    expected: Option<String>,
}

#[test]
fn client_ip_is_read_exactly_as_the_app_reads_it() -> Result<(), serde_json::Error> {
    let cases: Vec<IpCase> = serde_json::from_str(&contract("client-ip/cases.json"))?;
    for case in cases {
        let got = client_ip(case.forwarded_for.as_deref(), None, case.trusted_proxy_hops).map(|ip| ip.to_string());
        assert_eq!(got, case.expected, "forwarded-for {:?}", case.forwarded_for);
    }
    Ok(())
}

#[test]
fn error_codes_are_exactly_the_agreed_list() -> Result<(), serde_json::Error> {
    let agreed: Vec<String> = serde_json::from_str(&contract("error-codes.json"))?;
    let ours: Vec<String> = ErrorCode::ALL.iter().map(|c| c.as_str().to_string()).collect();
    assert_eq!(ours, agreed);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedConfig {
    workbook_max_bytes: u64,
    token_ttl_seconds: u64,
    token_leeway_seconds: u64,
    token_issuer: String,
    token_audience: String,
}

#[test]
fn defaults_equal_the_apps_single_source_of_truth() -> Result<(), serde_json::Error> {
    let shared: SharedConfig = serde_json::from_str(&contract("app-config.json"))?;
    let limits = Limits::default();
    assert_eq!(limits.workbook_max_bytes, shared.workbook_max_bytes);
    assert_eq!(limits.token_ttl_seconds, shared.token_ttl_seconds);
    assert_eq!(limits.token_leeway_seconds, shared.token_leeway_seconds);
    assert_eq!(limits.token_issuer, shared.token_issuer);
    assert_eq!(limits.token_audience, shared.token_audience);
    Ok(())
}
