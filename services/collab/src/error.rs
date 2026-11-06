//! The service's error envelope: `{ "error": { "code", "message", "requestId" } }`, with only the
//! codes in contracts/error-codes.json, all of which exist in the app's catalog (Decision 26).
//! The app maps codes to its own friendly messages; the message here is a short fallback.
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    ValidationFailed,
    Unauthenticated,
    Forbidden,
    NotFound,
    RequestTooLarge,
    WorkbookTooLarge,
    WorkbookUnreadable,
    Internal,
}

impl ErrorCode {
    pub const ALL: [ErrorCode; 8] = [
        ErrorCode::ValidationFailed,
        ErrorCode::Unauthenticated,
        ErrorCode::Forbidden,
        ErrorCode::NotFound,
        ErrorCode::RequestTooLarge,
        ErrorCode::WorkbookTooLarge,
        ErrorCode::WorkbookUnreadable,
        ErrorCode::Internal,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::ValidationFailed => "VALIDATION_FAILED",
            ErrorCode::Unauthenticated => "UNAUTHENTICATED",
            ErrorCode::Forbidden => "FORBIDDEN",
            ErrorCode::NotFound => "NOT_FOUND",
            ErrorCode::RequestTooLarge => "REQUEST_TOO_LARGE",
            ErrorCode::WorkbookTooLarge => "WORKBOOK_TOO_LARGE",
            ErrorCode::WorkbookUnreadable => "WORKBOOK_UNREADABLE",
            ErrorCode::Internal => "INTERNAL",
        }
    }

    pub fn status(self) -> StatusCode {
        match self {
            ErrorCode::ValidationFailed => StatusCode::BAD_REQUEST,
            ErrorCode::Unauthenticated => StatusCode::UNAUTHORIZED,
            ErrorCode::Forbidden => StatusCode::FORBIDDEN,
            ErrorCode::NotFound => StatusCode::NOT_FOUND,
            ErrorCode::RequestTooLarge | ErrorCode::WorkbookTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            ErrorCode::WorkbookUnreadable => StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn fallback_message(self) -> &'static str {
        match self {
            ErrorCode::ValidationFailed => "The request is not valid.",
            ErrorCode::Unauthenticated => "Not signed in.",
            ErrorCode::Forbidden => "Not allowed.",
            ErrorCode::NotFound => "Not found.",
            ErrorCode::RequestTooLarge => "The request is too large.",
            ErrorCode::WorkbookTooLarge => "The workbook is too large.",
            ErrorCode::WorkbookUnreadable => "The file could not be read as a workbook.",
            ErrorCode::Internal => "Something went wrong.",
        }
    }
}

/// An error answered to a caller. The detail goes to the log, never into the response.
#[derive(Debug)]
pub struct ApiError {
    pub code: ErrorCode,
    pub request_id: String,
}

impl ApiError {
    pub fn new(code: ErrorCode, request_id: impl Into<String>) -> Self {
        Self {
            code,
            request_id: request_id.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = json!({
            "error": {
                "code": self.code.as_str(),
                "message": self.code.fallback_message(),
                "requestId": self.request_id,
            }
        });
        (self.code.status(), Json(body)).into_response()
    }
}
