//! Calls to the app's internal routes for live editing (Decision 58): load a workbook, store
//! accepted changes, save snapshots. They carry the internal service token.
use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};

use crate::http::INTERNAL_TOKEN_HEADER;

#[derive(Clone)]
pub struct AppClient {
    base: String,
    token: String,
    http: reqwest::Client,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("the app could not be reached: {0}")]
    Unreachable(String),
    #[error("the app answered {0}")]
    Status(u16),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveState {
    pub version_id: String,
    pub ops: Vec<StoredOpDto>,
    pub last_seq: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredOpDto {
    pub seq: u64,
    pub step: Value,
}

/// One accepted change, as stored.
pub struct OpToStore {
    pub seq: u64,
    pub user_id: String,
    pub client_command_id: String,
    pub command_id: String,
    pub step: Value,
}

impl AppClient {
    pub fn new(base: &str, token: &str) -> AppClient {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_default();
        AppClient {
            base: base.trim_end_matches('/').to_string(),
            token: token.to_string(),
            http,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    async fn check(response: Result<reqwest::Response, reqwest::Error>) -> Result<reqwest::Response, AppError> {
        let response = response.map_err(|e| AppError::Unreachable(e.to_string()))?;
        if response.status().is_success() {
            Ok(response)
        } else {
            Err(AppError::Status(response.status().as_u16()))
        }
    }

    /// The current version, the changes stored on it, and the last sequence number.
    pub async fn state(&self, workbook_id: &str) -> Result<LiveState, AppError> {
        let response = Self::check(
            self.http
                .get(self.url(&format!("/api/internal/collab/workbooks/{workbook_id}/state")))
                .header(INTERNAL_TOKEN_HEADER, &self.token)
                .send()
                .await,
        )
        .await?;
        #[derive(Deserialize)]
        struct Envelope {
            data: LiveState,
        }
        response
            .json::<Envelope>()
            .await
            .map(|e| e.data)
            .map_err(|e| AppError::Unreachable(e.to_string()))
    }

    /// The current version's bytes.
    pub async fn content(&self, workbook_id: &str) -> Result<Vec<u8>, AppError> {
        let response = Self::check(
            self.http
                .get(self.url(&format!("/api/internal/collab/workbooks/{workbook_id}/content")))
                .header(INTERNAL_TOKEN_HEADER, &self.token)
                .send()
                .await,
        )
        .await?;
        response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| AppError::Unreachable(e.to_string()))
    }

    /// Stores accepted changes built on `base_version_id` (before anyone else hears of them).
    pub async fn store_ops(&self, workbook_id: &str, base_version_id: &str, ops: &[OpToStore]) -> Result<(), AppError> {
        let body = json!({
            "baseVersionId": base_version_id,
            "ops": ops.iter().map(|op| json!({
                "seq": op.seq, "userId": op.user_id, "clientCommandId": op.client_command_id,
                "commandId": op.command_id, "step": op.step,
            })).collect::<Vec<_>>(),
        });
        Self::check(
            self.http
                .post(self.url(&format!("/api/internal/collab/workbooks/{workbook_id}/ops")))
                .header(INTERNAL_TOKEN_HEADER, &self.token)
                .json(&body)
                .send()
                .await,
        )
        .await
        .map(|_| ())
    }

    /// Tells the app whether people are editing live (P3-FALLBACK-02); renewed every 30 seconds.
    pub async fn heartbeat(&self, workbook_id: &str, editing: bool) -> Result<(), AppError> {
        Self::check(
            self.http
                .post(self.url(&format!("/api/internal/collab/workbooks/{workbook_id}/heartbeat")))
                .header(INTERNAL_TOKEN_HEADER, &self.token)
                .json(&json!({ "editing": editing }))
                .send()
                .await,
        )
        .await
        .map(|_| ())
    }

    /// Saves a snapshot as a "Live editing" version on top of `base_version_id`; answers the new
    /// version's id. `Status(409)`: another version became current meanwhile (a restore).
    pub async fn snapshot(
        &self,
        workbook_id: &str,
        base_version_id: &str,
        contributors: &[String],
        bytes: Vec<u8>,
    ) -> Result<String, AppError> {
        let response = Self::check(
            self.http
                .post(self.url(&format!("/api/internal/collab/workbooks/{workbook_id}/snapshots")))
                .header(INTERNAL_TOKEN_HEADER, &self.token)
                .header("x-base-version", base_version_id)
                .header("x-contributors", contributors.join(","))
                .header(
                    "content-type",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
                .body(bytes)
                .send()
                .await,
        )
        .await?;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Saved {
            version_id: String,
        }
        #[derive(Deserialize)]
        struct Envelope {
            data: Saved,
        }
        response
            .json::<Envelope>()
            .await
            .map(|e| e.data.version_id)
            .map_err(|e| AppError::Unreachable(e.to_string()))
    }
}
