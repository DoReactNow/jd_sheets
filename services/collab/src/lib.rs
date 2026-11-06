//! JD Sheets collab service: validates workbooks with GridCraft's engine (Phase 0) and, from
//! Phase 3, runs live co-editing. It owns no users or roles: it trusts only short-lived collab
//! tokens issued by the app and the internal service token (Decision 10).
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::todo,
    clippy::unimplemented
)]

pub mod app_client;
pub mod clock;
pub mod config;
pub mod engine;
pub mod error;
pub mod http;
pub mod ip;
pub mod rooms;
pub mod token;
pub mod ws;
