//! The live editing WebSocket (Phase 3): `GET /collab/{workbook_id}`. The first message must be
//! `{type:"auth", token}` (a collab token, Decision 10). Then:
//! - from the person: `command {clientCommandId, baseSeq, step}`, `presence {selection}`,
//!   `refresh {token}`, `resync`, `ping`;
//! - to the person: `welcome {seq, you, people, full}` followed by the workbook (a binary frame),
//!   `applied {seq, clientCommandId, step}`, `rejected {clientCommandId, reason}`,
//!   `presence {people}`, `role {role}`, `resync {seq}` + bytes, `accessChanged`, `pong`.
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::clock::{Clock, SystemClock};
use crate::engine::live::Role;
use crate::http::AppState;
use crate::ip::client_ip;
use crate::rooms::{self, Conn, Out};
use crate::token::{CollabClaims, TokenRole, verify};

/// Largest message a person may send (a paste carries its cells); anything bigger closes.
pub const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
/// Per connection: at most this many messages in RATE_WINDOW (P3-WS-07).
pub const RATE_LIMIT: u32 = 300;
pub const RATE_WINDOW: Duration = Duration::from_secs(10);
/// The first message (auth) must arrive within this long.
pub const AUTH_WITHIN: Duration = Duration::from_secs(10);

/// Close codes the page understands.
pub mod close {
    pub const AUTH: u16 = 4401;
    pub const EXPIRED: u16 = 4402;
    pub const ACCESS_CHANGED: u16 = 4403;
    pub const PROTOCOL: u16 = 1008;
    pub const UNAVAILABLE: u16 = 1011;
}

pub async fn upgrade(
    State(state): State<AppState>,
    Path(workbook_id): Path<String>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // As the app reads it (Decision 50): with no proxy in front (local runs), the socket address
    // stands in for the entry the nearest proxy would have added. Production always has Caddy.
    let forwarded = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| Some(addr.ip().to_string()));
    let ip = client_ip(forwarded.as_deref(), Some(addr.ip()), state.config.trusted_proxy_hops);
    ws.max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| serve(state, workbook_id, ip, socket))
}

fn role_of(claims: &CollabClaims) -> Role {
    match claims.role {
        TokenRole::Editor => Role::Editor,
        TokenRole::Commenter => Role::Commenter,
        TokenRole::Viewer => Role::Viewer,
    }
}

async fn close_with(socket: &mut WebSocket, code: u16, reason: &'static str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await;
}

fn text_of(message: &Message) -> Option<Value> {
    match message {
        Message::Text(text) => serde_json::from_str(text.as_str()).ok(),
        _ => None,
    }
}

async fn serve(state: AppState, workbook_id: String, ip: Option<std::net::IpAddr>, mut socket: WebSocket) {
    let clock = SystemClock;
    // 1. Who is this: the first message carries the token (P3-WS-01, -02).
    let first = tokio::time::timeout(AUTH_WITHIN, socket.next())
        .await
        .ok()
        .flatten()
        .and_then(Result::ok);
    let token = first
        .as_ref()
        .and_then(text_of)
        .filter(|v| v["type"] == "auth")
        .and_then(|v| v["token"].as_str().map(str::to_string));
    let claims = token
        .and_then(|t| verify(&t, &state.config.collab_token_secret, &state.config.limits, &clock, ip).ok())
        .filter(|c| c.wb == workbook_id);
    let Some(mut claims) = claims else {
        close_with(&mut socket, close::AUTH, "auth").await;
        return;
    };
    // 2. The workbook's room.
    let room = match state.rooms.open(&workbook_id).await {
        Ok(room) => room,
        Err(error) if error == rooms::BUSY => {
            // The page falls back to one editor at a time, as when the service is down.
            close_with(&mut socket, close::UNAVAILABLE, rooms::BUSY).await;
            return;
        }
        Err(error) => {
            tracing::error!(workbook = %workbook_id, %error, "could not open a live workbook");
            close_with(&mut socket, close::UNAVAILABLE, "unavailable").await;
            return;
        }
    };
    let conn_id = state.rooms.next_conn_id();
    let (tx, mut rx) = mpsc::unbounded_channel::<Out>();
    {
        let mut r = room.lock().await;
        let mut role = role_of(&claims);
        // A full workbook: the next editor views (P3-PERF-03).
        let full = role == Role::Editor && rooms::editors(&r, &claims.sub) >= rooms::MAX_EDITORS;
        if full {
            role = Role::Viewer;
        }
        r.conns.insert(
            conn_id,
            Conn {
                user_id: claims.sub.clone(),
                name: claims.name.clone(),
                role,
                selection: None,
                tx: tx.clone(),
            },
        );
        r.empty_since = None;
        let welcome = json!({
            "type": "welcome",
            "seq": r.doc.seq(),
            "you": { "userId": claims.sub, "colour": rooms::colour_for(&claims.sub), "role": rooms::role_name(role) },
            "full": full,
        });
        let bytes = tokio::task::block_in_place(|| r.doc.xlsx()).unwrap_or_default();
        let _ = tx.send(Out::Text(welcome.to_string()));
        let _ = tx.send(Out::Binary(bytes));
        rooms::send_all(&r, &rooms::presence(&r));
    }
    // An editor arriving marks the workbook as edited live at once (P3-FALLBACK-02).
    {
        let rooms = state.rooms.clone();
        let room = room.clone();
        tokio::spawn(async move { rooms.heartbeat(&room).await });
    }
    // 3. Messages both ways until either side goes.
    let (mut sink, mut stream) = socket.split();
    // A close jumps the queue: a misbehaving connection gets no backlog first (P3-WS-06, -07).
    let (close_tx, mut close_rx) = tokio::sync::oneshot::channel::<(u16, &'static str)>();
    let writer = tokio::spawn(async move {
        loop {
            let next = tokio::select! {
                biased;
                close = &mut close_rx => match close {
                    Ok((code, reason)) => Out::Close(code, reason),
                    Err(_) => match rx.recv().await { Some(out) => out, None => break },
                },
                out = rx.recv() => match out { Some(out) => out, None => break },
            };
            let message = match next {
                Out::Text(text) => Message::Text(text.into()),
                Out::Binary(bytes) => Message::Binary(bytes.into()),
                Out::Close(code, reason) => {
                    let _ = sink
                        .send(Message::Close(Some(CloseFrame {
                            code,
                            reason: reason.into(),
                        })))
                        .await;
                    break;
                }
            };
            if sink.send(message).await.is_err() {
                break;
            }
        }
    });
    let mut close_tx = Some(close_tx);
    let mut close_now = |code: u16, reason: &'static str| {
        if let Some(tx) = close_tx.take() {
            let _ = tx.send((code, reason));
        }
    };
    let mut window_start = tokio::time::Instant::now();
    let mut count = 0u32;
    let mut expiry_check = tokio::time::interval(Duration::from_secs(5));
    loop {
        tokio::select! {
            incoming = stream.next() => {
                let Some(Ok(message)) = incoming else { break };
                if window_start.elapsed() > RATE_WINDOW {
                    window_start = tokio::time::Instant::now();
                    count = 0;
                }
                count += 1;
                if count > RATE_LIMIT {
                    close_now(close::PROTOCOL, "rate");
                    break;
                }
                match message {
                    Message::Close(_) => break,
                    Message::Ping(_) | Message::Pong(_) => continue,
                    Message::Binary(_) => { close_now(close::PROTOCOL, "unexpected"); break; }
                    Message::Text(_) => {}
                }
                let Some(value) = text_of(&message) else { close_now(close::PROTOCOL, "unexpected"); break; };
                match value["type"].as_str() {
                    Some("command") => {
                        let ccid = value["clientCommandId"].as_str().unwrap_or_default().to_string();
                        let base = value["baseSeq"].as_u64().unwrap_or(0);
                        let mut r = room.lock().await;
                        if let Err(rejection) = rooms::submit(&state.rooms.app, &mut r, conn_id, &ccid, base, &value["step"]).await {
                            let _ = tx.send(Out::Text(json!({ "type": "rejected", "clientCommandId": ccid, "reason": rejection.as_str() }).to_string()));
                        }
                    }
                    Some("presence") => {
                        let mut r = room.lock().await;
                        if let Some(c) = r.conns.get_mut(&conn_id) {
                            c.selection = Some(value["selection"].clone());
                        }
                        rooms::send_all(&r, &rooms::presence(&r));
                    }
                    Some("refresh") => {
                        // A fresh token keeps the connection; it may carry a new role (P3-WS-03, -05).
                        let fresh = value["token"].as_str().and_then(|t| verify(t, &state.config.collab_token_secret, &state.config.limits, &clock, ip).ok());
                        match fresh.filter(|c| c.sub == claims.sub && c.wb == claims.wb && c.sid == claims.sid) {
                            Some(fresh) => {
                                let role = role_of(&fresh);
                                claims = fresh;
                                let mut r = room.lock().await;
                                let changed = r.conns.get(&conn_id).is_some_and(|c| c.role != role);
                                if let Some(c) = r.conns.get_mut(&conn_id) { c.role = role; }
                                if changed {
                                    let _ = tx.send(Out::Text(json!({ "type": "role", "role": rooms::role_name(role) }).to_string()));
                                    rooms::send_all(&r, &rooms::presence(&r));
                                }
                            }
                            None => { close_now(close::AUTH, "auth"); break; }
                        }
                    }
                    Some("resync") => {
                        let r = room.lock().await;
                        let bytes = tokio::task::block_in_place(|| r.doc.xlsx()).unwrap_or_default();
                        let _ = tx.send(Out::Text(json!({ "type": "resync", "seq": r.doc.seq() }).to_string()));
                        let _ = tx.send(Out::Binary(bytes));
                    }
                    Some("ping") => { let _ = tx.send(Out::Text(json!({ "type": "pong" }).to_string())); }
                    Some("snapshot") => {
                        // "Save a version now" (Ctrl/Cmd+S while live), for editors.
                        let editor = room.lock().await.conns.get(&conn_id).is_some_and(|c| c.role == Role::Editor);
                        if editor {
                            let rooms = state.rooms.clone();
                            let room = room.clone();
                            let tx = tx.clone();
                            tokio::spawn(async move {
                                rooms.snapshot(&room).await;
                                let saved = !room.lock().await.dirty;
                                let _ = tx.send(Out::Text(json!({ "type": "saved", "ok": saved }).to_string()));
                            });
                        }
                    }
                    _ => { close_now(close::PROTOCOL, "unexpected"); break; }
                }
            }
            _ = expiry_check.tick() => {
                // A token that was not refreshed in time ends the connection (P3-WS-03).
                if claims.exp.saturating_add(state.config.limits.token_leeway_seconds) < clock.now_unix() {
                    close_now(close::EXPIRED, "expired");
                    break;
                }
            }
        }
    }
    // 4. Gone: presence updates at once (P3-PRES-03); the last one out triggers a version.
    let last_out = {
        let mut r = room.lock().await;
        r.conns.remove(&conn_id);
        rooms::send_all(&r, &rooms::presence(&r));
        if r.conns.is_empty() {
            r.empty_since = Some(tokio::time::Instant::now());
        }
        r.conns.is_empty()
    };
    drop(tx);
    // Let what is queued (a close frame last) reach the person; a reader that never reads ends it.
    let _ = tokio::time::timeout(Duration::from_secs(30), writer).await;
    let rooms = state.rooms.clone();
    tokio::spawn(async move {
        rooms.heartbeat(&room).await;
        if last_out {
            rooms.snapshot(&room).await;
        }
    });
}

/// POST /internal/access-changed `{workbookId?, userId?, reload?}`: a share, role, deactivation or
/// restore changed who may do what (P3-WS-04, -05, P3-RESTORE-01). Matching connections are told
/// and closed; they reconnect with a fresh token if they still have access. `reload` loads the
/// workbook again and resyncs everyone.
pub async fn access_changed(state: &AppState, body: &Value) {
    let workbook = body["workbookId"].as_str();
    let user = body["userId"].as_str();
    for room in state.rooms.all().await {
        let id = room.lock().await.workbook_id.clone();
        let matches = workbook.is_none_or(|w| id == w);
        if !matches {
            continue;
        }
        if body["reload"].as_bool() == Some(true) {
            state.rooms.reload(&room).await;
            continue;
        }
        let r = room.lock().await;
        for conn in r.conns.values().filter(|c| user.is_none_or(|u| c.user_id == u)) {
            let _ = conn.tx.send(Out::Text(json!({ "type": "accessChanged" }).to_string()));
            let _ = conn.tx.send(Out::Close(close::ACCESS_CHANGED, "access-changed"));
        }
    }
}

/// Saves due versions and unloads idle rooms every 30 seconds.
pub fn start_background(state: &AppState) {
    let rooms: Arc<rooms::Rooms> = state.rooms.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30));
        loop {
            tick.tick().await;
            rooms.tick().await;
        }
    });
}
