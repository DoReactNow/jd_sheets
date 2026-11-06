//! The service's HTTP surface (P0-RUST-01, P0-RUST-02, P0-ACC-04 for the service side,
//! P0-VAL-02, P0-VAL-05).
use std::collections::HashMap;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use jd_collab::config::Config;
use jd_collab::http::{AppState, router};
use serde_json::Value;
use tower::ServiceExt;

const TOKEN: &str = "test-only-internal-token-0123456789abcdef";

fn app() -> axum::Router {
    let vars: HashMap<String, String> = [
        ("APP_ENV", "test"),
        ("COLLAB_PORT", "47331"),
        ("DATABASE_URL", "postgresql://u:p@127.0.0.1:47322/jdsheets_test"),
        ("COLLAB_TOKEN_SECRET", "test-only-collab-secret-0123456789abcdef"),
        ("INTERNAL_SERVICE_TOKEN", TOKEN),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    let config = Config::from_env(&vars).unwrap_or_else(|e| unreachable_config(&e.0));
    router(AppState {
        config: Arc::new(config),
    })
}

#[allow(clippy::panic)]
fn unreachable_config(message: &str) -> Config {
    panic!("test config invalid: {message}")
}

async fn send(request: Request<Body>) -> (StatusCode, Vec<u8>) {
    let response = app().oneshot(request).await.unwrap_or_else(|e| match e {});
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .map(|b| b.to_bytes().to_vec())
        .unwrap_or_default();
    (status, bytes)
}

fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap_or(Value::Null)
}

fn internal(path: &str, body: Vec<u8>, token: Option<&str>) -> Request<Body> {
    let mut builder = Request::post(path);
    if let Some(token) = token {
        builder = builder.header("x-internal-token", token);
    }
    builder.body(Body::from(body)).unwrap_or_default()
}

#[tokio::test]
async fn health_answers_with_the_envelope() {
    let (status, body) = send(Request::get("/health").body(Body::empty()).unwrap_or_default()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json(&body)["data"]["status"], "ok");
}

#[tokio::test]
async fn internal_routes_need_the_service_token() {
    for token in [None, Some("wrong"), Some("test-only-internal-token-0123456789abcdeX")] {
        let (status, body) = send(internal("/internal/workbooks/blank", vec![], token)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "token {token:?}");
        assert_eq!(json(&body)["error"]["code"], "UNAUTHENTICATED");
        assert!(json(&body)["error"]["requestId"].is_string());
    }
}

#[tokio::test]
async fn blank_then_validate_round_trips_through_the_engine() {
    let (status, blank) = send(internal("/internal/workbooks/blank", vec![], Some(TOKEN))).await;
    assert_eq!(status, StatusCode::OK);
    assert!(blank.starts_with(b"PK"));
    let (status, body) = send(internal("/internal/workbooks/validate", blank, Some(TOKEN))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json(&body)["data"]["sheets"].as_array().map(Vec::len), Some(1));
}

#[tokio::test]
async fn validate_refuses_an_unreadable_file_with_a_catalog_code() {
    let (status, body) = send(internal(
        "/internal/workbooks/validate",
        b"not a workbook".to_vec(),
        Some(TOKEN),
    ))
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json(&body)["error"]["code"], "WORKBOOK_UNREADABLE");
    let text = String::from_utf8_lossy(&body);
    assert!(
        !text.contains("zip") && !text.contains("panic"),
        "no internals leak: {text}"
    );
}

#[tokio::test]
async fn validate_refuses_an_oversized_body() {
    let big = vec![b'x'; 50 * 1024 * 1024 + 10];
    let (status, _) = send(internal("/internal/workbooks/validate", big, Some(TOKEN))).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn unknown_paths_get_the_not_found_envelope() {
    let (status, body) = send(Request::get("/nope").body(Body::empty()).unwrap_or_default()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json(&body)["error"]["code"], "NOT_FOUND");
}

fn golden(name: &str) -> Vec<u8> {
    std::fs::read(format!("{}/../../golden/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap_or_default()
}

fn diff_request(base: &[u8], new: &[u8], author: &str, token: Option<&str>) -> Request<Body> {
    let mut body = base.to_vec();
    body.extend_from_slice(new);
    let mut builder = Request::post(format!("/internal/workbooks/diff-kind?author={author}"))
        .header("x-base-length", base.len().to_string());
    if let Some(token) = token {
        builder = builder.header("x-internal-token", token);
    }
    builder.body(Body::from(body)).unwrap_or_default()
}

#[tokio::test]
async fn diff_kind_answers_the_kind_of_change() {
    let base = golden("comments.xlsx");
    let (status, body) = send(diff_request(&base, &base, "Asha%20Rao", Some(TOKEN))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json(&body)["data"]["kind"], "NONE");
    let other = golden("basics.xlsx");
    let (_, body) = send(diff_request(&base, &other, "Asha", Some(TOKEN))).await;
    assert_eq!(json(&body)["data"]["kind"], "OTHER");
}

#[tokio::test]
async fn diff_kind_needs_the_token_an_author_and_two_workbooks() {
    let base = golden("comments.xlsx");
    let (status, _) = send(diff_request(&base, &base, "Asha", None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = send(diff_request(&base, &base, "", Some(TOKEN))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, body) = send(diff_request(&base, b"not a workbook", "Asha", Some(TOKEN))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json(&body)["error"]["code"], "WORKBOOK_UNREADABLE");
}

#[tokio::test]
async fn convert_turns_an_import_into_xlsx() {
    let (status, bytes) = send(internal(
        "/internal/workbooks/convert?ext=csv",
        b"a,b\n1,2\n".to_vec(),
        Some(TOKEN),
    ))
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(bytes.starts_with(b"PK"));
    let (status, body) = send(internal(
        "/internal/workbooks/convert?ext=exe",
        b"MZ".to_vec(),
        Some(TOKEN),
    ))
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json(&body)["error"]["code"], "WORKBOOK_UNREADABLE");
}
