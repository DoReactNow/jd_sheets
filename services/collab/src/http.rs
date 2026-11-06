//! HTTP routes. `/health` is open; everything under `/internal/` needs the internal service token
//! (Decision 10) and is reachable only on the private network (Caddy refuses it from outside).
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde_json::json;

use crate::config::Config;
use crate::engine::{self, EngineFailure};
use crate::error::{ApiError, ErrorCode};

pub const INTERNAL_TOKEN_HEADER: &str = "x-internal-token";
const XLSX_MEDIA_TYPE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
}

pub fn router(state: AppState) -> Router {
    // Bodies a little over the workbook limit reach the handler, which answers WORKBOOK_TOO_LARGE;
    // anything bigger is cut off by the body limit (413).
    let body_limit = usize::try_from(state.config.limits.workbook_max_bytes)
        .unwrap_or(usize::MAX)
        .saturating_add(1);
    let internal = Router::new()
        .route("/internal/workbooks/validate", post(validate))
        .route("/internal/workbooks/blank", post(blank))
        .layer(DefaultBodyLimit::max(body_limit))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_internal_token));
    Router::new()
        .route("/health", get(health))
        .merge(internal)
        .fallback(not_found)
        .with_state(state)
}

fn request_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Constant-time comparison, so the token cannot be guessed byte by byte from timing.
fn same_secret(given: &[u8], expected: &[u8]) -> bool {
    if given.len() != expected.len() {
        return false;
    }
    given.iter().zip(expected).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

async fn require_internal_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    let given = headers
        .get(INTERNAL_TOKEN_HEADER)
        .map(|v| v.as_bytes())
        .unwrap_or_default();
    if !same_secret(given, state.config.internal_service_token.as_bytes()) {
        return ApiError::new(ErrorCode::Unauthenticated, request_id()).into_response();
    }
    next.run(request).await
}

async fn health() -> Response {
    (StatusCode::OK, axum::Json(json!({ "data": { "status": "ok" } }))).into_response()
}

async fn not_found() -> Response {
    ApiError::new(ErrorCode::NotFound, request_id()).into_response()
}

fn failure_code(failure: EngineFailure) -> ErrorCode {
    match failure {
        EngineFailure::TooLarge => ErrorCode::WorkbookTooLarge,
        EngineFailure::Unreadable | EngineFailure::PasswordProtected => ErrorCode::WorkbookUnreadable,
    }
}

/// Runs engine work on the blocking pool with a time limit; a slow or crashing file is refused.
async fn run_engine<T: Send + 'static>(
    timeout_seconds: u64,
    work: impl FnOnce() -> Result<T, EngineFailure> + Send + 'static,
) -> Result<T, ErrorCode> {
    match tokio::time::timeout(Duration::from_secs(timeout_seconds), tokio::task::spawn_blocking(work)).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(failure))) => Err(failure_code(failure)),
        Ok(Err(_join_error)) => Err(ErrorCode::WorkbookUnreadable),
        Err(_elapsed) => Err(ErrorCode::WorkbookUnreadable),
    }
}

/// POST /internal/workbooks/validate — body: the workbook bytes.
async fn validate(State(state): State<AppState>, body: Bytes) -> Response {
    let id = request_id();
    let limits = state.config.limits.clone();
    if body.len() as u64 > limits.workbook_max_bytes {
        return ApiError::new(ErrorCode::WorkbookTooLarge, id).into_response();
    }
    let timeout = limits.validate_timeout_seconds;
    match run_engine(timeout, move || {
        engine::open_xlsx(&body, &limits).map(|wb| engine::summarize(&wb))
    })
    .await
    {
        Ok(summary) => (StatusCode::OK, axum::Json(json!({ "data": summary }))).into_response(),
        Err(code) => {
            tracing::info!(request_id = %id, code = code.as_str(), "workbook refused");
            ApiError::new(code, id).into_response()
        }
    }
}

/// POST /internal/workbooks/blank — answers a new, empty workbook made by GridCraft.
async fn blank(State(state): State<AppState>) -> Response {
    match run_engine(state.config.limits.validate_timeout_seconds, engine::blank_workbook).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, XLSX_MEDIA_TYPE)], bytes).into_response(),
        Err(_) => ApiError::new(ErrorCode::Internal, request_id()).into_response(),
    }
}
