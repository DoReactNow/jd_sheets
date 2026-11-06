//! Live editing over real WebSockets (Phase 3): P3-WS-*, P3-ORDER-*, P3-ROLE-01, P3-PRES-*,
//! P3-PERF-03, P3-SNAP-01, P3-RECOV-01, P3-RESTORE-01. The app's internal routes are a small
//! in-memory fake.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use futures_util::{SinkExt, StreamExt};
use jd_collab::config::Config;
use jd_collab::http::{AppState, router};
use jsonwebtoken::{EncodingKey, Header, encode};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;

const SECRET: &str = "test-only-collab-secret-0123456789abcdef";
const TOKEN: &str = "test-only-internal-token-0123456789abcdef";
const WB: &str = "0190f5e0-0000-7000-8000-00000000000a";

#[derive(Default)]
struct FakeApp {
    version: String,
    bytes: Vec<u8>,
    ops: Vec<Value>,
    snapshots: u32,
    fail_store: bool,
}

type Shared = Arc<Mutex<FakeApp>>;

async fn fake_app(shared: Shared) -> String {
    async fn state(State(s): State<Shared>, Path(_id): Path<String>) -> axum::Json<Value> {
        let app = s.lock().unwrap();
        let on: Vec<&Value> = app
            .ops
            .iter()
            .filter(|o| o["baseVersionId"] == app.version.as_str())
            .collect();
        let last = app.ops.iter().map(|o| o["seq"].as_u64().unwrap()).max().unwrap_or(0);
        axum::Json(json!({ "data": { "versionId": app.version, "versionNumber": 1, "ops": on, "lastSeq": last } }))
    }
    async fn content(State(s): State<Shared>, Path(_id): Path<String>) -> Vec<u8> {
        s.lock().unwrap().bytes.clone()
    }
    async fn ops(
        State(s): State<Shared>,
        Path(_id): Path<String>,
        axum::Json(body): axum::Json<Value>,
    ) -> (axum::http::StatusCode, axum::Json<Value>) {
        let mut app = s.lock().unwrap();
        if app.fail_store {
            return (axum::http::StatusCode::SERVICE_UNAVAILABLE, axum::Json(json!({})));
        }
        for op in body["ops"].as_array().unwrap() {
            let mut op = op.clone();
            op["baseVersionId"] = body["baseVersionId"].clone();
            app.ops.push(op);
        }
        (
            axum::http::StatusCode::OK,
            axum::Json(json!({ "data": { "stored": 1 } })),
        )
    }
    async fn snapshot(
        State(s): State<Shared>,
        Path(_id): Path<String>,
        headers: HeaderMap,
        body: Bytes,
    ) -> (axum::http::StatusCode, axum::Json<Value>) {
        let mut app = s.lock().unwrap();
        if headers.get("x-base-version").and_then(|v| v.to_str().ok()) != Some(app.version.as_str()) {
            return (axum::http::StatusCode::CONFLICT, axum::Json(json!({})));
        }
        app.snapshots += 1;
        app.version = format!("0190f5e0-0000-7000-8000-0000000001{:02}", app.snapshots);
        app.bytes = body.to_vec();
        (
            axum::http::StatusCode::CREATED,
            axum::Json(json!({ "data": { "versionId": app.version } })),
        )
    }
    let app = Router::new()
        .route("/api/internal/collab/workbooks/{id}/state", get(state))
        .route("/api/internal/collab/workbooks/{id}/content", get(content))
        .route("/api/internal/collab/workbooks/{id}/ops", post(ops))
        .route("/api/internal/collab/workbooks/{id}/snapshots", post(snapshot))
        .route(
            "/api/internal/collab/workbooks/{id}/heartbeat",
            post(|| async { axum::Json(json!({ "data": { "ok": true } })) }),
        )
        .with_state(shared);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{address}")
}

async fn service(app_url: &str) -> (SocketAddr, AppState) {
    let vars: HashMap<String, String> = [
        ("APP_ENV", "test"),
        ("COLLAB_PORT", "47331"),
        ("DATABASE_URL", "postgresql://u:p@127.0.0.1:47322/jdsheets_test"),
        ("COLLAB_TOKEN_SECRET", SECRET),
        ("INTERNAL_SERVICE_TOKEN", TOKEN),
        ("APP_INTERNAL_URL", app_url),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    let state = AppState::new(Config::from_env(&vars).unwrap());
    let app = router(state.clone()).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (address, state)
}

async fn setup() -> (SocketAddr, AppState, Shared) {
    let shared: Shared = Arc::new(Mutex::new(FakeApp {
        version: "0190f5e0-0000-7000-8000-000000000001".into(),
        bytes: jd_collab::engine::blank_workbook().unwrap(),
        ..FakeApp::default()
    }));
    let app_url = fake_app(shared.clone()).await;
    let (address, state) = service(&app_url).await;
    (address, state, shared)
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn token(user: &str, name: &str, role: &str, wb: &str, ip: &str, iat: u64) -> String {
    let claims = json!({
        "iss": "jd-sheets-app", "aud": "jd-sheets-collab", "sub": user, "sid": format!("s-{user}"),
        "wb": wb, "role": role, "own": false, "ip": ip, "name": name, "iat": iat, "exp": iat + 300, "jti": "j",
    });
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(SECRET.as_bytes()),
    )
    .unwrap()
}

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect_with(address: SocketAddr, token: &str) -> Ws {
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{address}/collab/{WB}"))
        .await
        .unwrap();
    ws.send(Message::Text(
        json!({ "type": "auth", "token": token }).to_string().into(),
    ))
    .await
    .unwrap();
    ws
}

async fn next(ws: &mut Ws) -> Message {
    tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("a message in time")
        .expect("open")
        .expect("ok")
}

/// The next text message of `kind`, skipping presence and the like.
async fn next_of(ws: &mut Ws, kind: &str) -> Value {
    loop {
        if let Message::Text(text) = next(ws).await {
            let value: Value = serde_json::from_str(text.as_str()).unwrap();
            if value["type"] == kind {
                return value;
            }
        }
    }
}

async fn join(address: SocketAddr, user: &str, name: &str, role: &str) -> (Ws, Value) {
    let mut ws = connect_with(address, &token(user, name, role, WB, "127.0.0.1", now())).await;
    let welcome = next_of(&mut ws, "welcome").await;
    assert!(
        matches!(next(&mut ws).await, Message::Binary(_)),
        "the workbook follows the welcome"
    );
    (ws, welcome)
}

async fn closed_with(ws: &mut Ws) -> u16 {
    let mut seen = 0;
    loop {
        seen += 1;
        let got = tokio::time::timeout(Duration::from_secs(5), ws.next()).await;
        if got.is_err() {
            panic!("not closed in time after {seen} messages");
        }
        match got.unwrap() {
            Some(Ok(Message::Close(Some(frame)))) => return frame.code.into(),
            Some(Ok(_)) => continue,
            _ => return 0,
        }
    }
}

fn step(cell: &str, input: &str) -> Value {
    json!({
        "sheet": 0, "sheetName": "Sheet1",
        "selection": { "active": {"row": 0, "col": 0}, "anchor": {"row": 0, "col": 0}, "ranges": [{"start": {"row": 0, "col": 0}, "end": {"row": 0, "col": 0}}] },
        "id": "cell.set", "params": { "cell": cell, "input": input },
    })
}

async fn send(ws: &mut Ws, value: Value) {
    ws.send(Message::Text(value.to_string().into())).await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_valid_token_opens_the_workbook_with_its_sequence_and_presence() {
    let (address, _, _) = setup().await;
    let (mut ws, welcome) = join(address, "u1", "Asha", "EDITOR").await;
    assert_eq!(welcome["seq"], 0);
    assert_eq!(welcome["you"]["role"], "EDITOR");
    let presence = next_of(&mut ws, "presence").await;
    assert_eq!(presence["people"][0]["name"], "Asha");
}

#[tokio::test(flavor = "multi_thread")]
async fn bad_tokens_are_refused_at_connect() {
    let (address, _, _) = setup().await;
    let cases = [
        token("u1", "A", "EDITOR", WB, "127.0.0.1", now() - 1000),
        token(
            "u1",
            "A",
            "EDITOR",
            "0190f5e0-0000-7000-8000-0000000000ff",
            "127.0.0.1",
            now(),
        ),
        token("u1", "A", "EDITOR", WB, "10.9.9.9", now()),
        "not-a-token".to_string(),
    ];
    for t in cases {
        let mut ws = connect_with(address, &t).await;
        assert_eq!(closed_with(&mut ws).await, 4401);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn changes_are_numbered_stored_and_sent_to_everyone_in_order() {
    let (address, _, shared) = setup().await;
    let (mut a, _) = join(address, "u1", "Asha", "EDITOR").await;
    let (mut b, _) = join(address, "u2", "Ravi", "EDITOR").await;
    for (i, input) in ["1", "2", "3"].iter().enumerate() {
        send(
            &mut a,
            json!({ "type": "command", "clientCommandId": format!("a-{i}"), "baseSeq": i, "step": step("A1", input) }),
        )
        .await;
    }
    for ws in [&mut a, &mut b] {
        let seqs: Vec<u64> = [
            next_of(ws, "applied").await,
            next_of(ws, "applied").await,
            next_of(ws, "applied").await,
        ]
        .iter()
        .map(|m| m["seq"].as_u64().unwrap())
        .collect();
        assert_eq!(seqs, vec![1, 2, 3]);
    }
    // A retry of the same change is applied once (P3-ORDER-03).
    send(
        &mut a,
        json!({ "type": "command", "clientCommandId": "a-0", "baseSeq": 3, "step": step("A1", "1") }),
    )
    .await;
    send(&mut a, json!({ "type": "ping" })).await;
    let reply = next_of(&mut a, "pong").await;
    assert_eq!(reply["type"], "pong");
    assert_eq!(shared.lock().unwrap().ops.len(), 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_viewers_changes_are_refused() {
    let (address, _, shared) = setup().await;
    let (mut v, _) = join(address, "u3", "Vik", "VIEWER").await;
    send(
        &mut v,
        json!({ "type": "command", "clientCommandId": "v-1", "baseSeq": 0, "step": step("A1", "x") }),
    )
    .await;
    let refused = next_of(&mut v, "rejected").await;
    assert_eq!(refused["reason"], "not-allowed");
    assert!(shared.lock().unwrap().ops.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn unknown_or_flooding_messages_close_only_that_connection() {
    let (address, _, _) = setup().await;
    let (mut bad, _) = join(address, "u1", "A", "EDITOR").await;
    let (mut good, _) = join(address, "u2", "B", "EDITOR").await;
    send(&mut bad, json!({ "type": "hack" })).await;
    assert_eq!(closed_with(&mut bad).await, 1008, "unknown type");
    let (mut flood, _) = join(address, "u3", "C", "EDITOR").await;
    for _ in 0..400 {
        if flood
            .send(Message::Text(json!({ "type": "ping" }).to_string().into()))
            .await
            .is_err()
        {
            break;
        }
    }
    assert_eq!(closed_with(&mut flood).await, 1008, "flood");
    send(&mut good, json!({ "type": "ping" })).await;
    assert_eq!(next_of(&mut good, "pong").await["type"], "pong");
}

#[tokio::test(flavor = "multi_thread")]
async fn presence_shows_each_person_once_with_their_token_name() {
    let (address, _, _) = setup().await;
    let (mut a, _) = join(address, "u1", "Asha", "EDITOR").await;
    let (_a2, _) = join(address, "u1", "Asha", "EDITOR").await;
    let (_b, _) = join(address, "u2", "Ravi", "VIEWER").await;
    let mut people = Vec::new();
    for _ in 0..4 {
        let p = next_of(&mut a, "presence").await;
        people = p["people"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x["name"].as_str().unwrap().to_string())
            .collect();
        if people.len() == 2 {
            break;
        }
    }
    assert_eq!(people, vec!["Asha", "Ravi"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refreshed_token_can_change_the_role_and_access_changes_close_connections() {
    let (address, state, _) = setup().await;
    let (mut a, _) = join(address, "u1", "Asha", "EDITOR").await;
    send(
        &mut a,
        json!({ "type": "refresh", "token": token("u1", "Asha", "VIEWER", WB, "127.0.0.1", now()) }),
    )
    .await;
    assert_eq!(next_of(&mut a, "role").await["role"], "VIEWER");
    jd_collab::ws::access_changed(&state, &json!({ "workbookId": WB, "userId": "u1" })).await;
    assert_eq!(next_of(&mut a, "accessChanged").await["type"], "accessChanged");
    assert_eq!(closed_with(&mut a).await, 4403);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_twenty_sixth_editor_views() {
    let (address, _, _) = setup().await;
    let mut kept = Vec::new();
    for i in 0..25 {
        kept.push(join(address, &format!("e{i}"), "E", "EDITOR").await.0);
    }
    let (_late, welcome) = join(address, "e25", "Late", "EDITOR").await;
    assert_eq!(welcome["full"], true);
    assert_eq!(welcome["you"]["role"], "VIEWER");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_last_one_out_saves_a_version_and_a_restart_replays_stored_changes() {
    let (address, _, shared) = setup().await;
    {
        let (mut a, _) = join(address, "u1", "Asha", "EDITOR").await;
        send(
            &mut a,
            json!({ "type": "command", "clientCommandId": "a-1", "baseSeq": 0, "step": step("B2", "42") }),
        )
        .await;
        next_of(&mut a, "applied").await;
        a.close(None).await.unwrap();
    }
    for _ in 0..50 {
        if shared.lock().unwrap().snapshots == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(
        shared.lock().unwrap().snapshots,
        1,
        "a version is saved when the last person leaves"
    );
    // A change after the snapshot, then a "restart": a new service instance on the same app.
    let (mut b, _) = join(address, "u2", "Ravi", "EDITOR").await;
    send(
        &mut b,
        json!({ "type": "command", "clientCommandId": "b-1", "baseSeq": 1, "step": step("C3", "7") }),
    )
    .await;
    next_of(&mut b, "applied").await;
    let fresh = setup_on(shared.clone()).await;
    let (_c, welcome) = join(fresh, "u3", "Chitra", "EDITOR").await;
    assert_eq!(welcome["seq"], 2, "the stored change after the snapshot is replayed");
}

async fn setup_on(shared: Shared) -> SocketAddr {
    let app_url = fake_app(shared).await;
    service(&app_url).await.0
}

#[tokio::test(flavor = "multi_thread")]
async fn a_change_that_cannot_be_stored_is_refused_and_not_sent() {
    let (address, _, shared) = setup().await;
    let (mut a, _) = join(address, "u1", "Asha", "EDITOR").await;
    shared.lock().unwrap().fail_store = true;
    send(
        &mut a,
        json!({ "type": "command", "clientCommandId": "a-1", "baseSeq": 0, "step": step("A1", "x") }),
    )
    .await;
    assert_eq!(next_of(&mut a, "rejected").await["reason"], "refused");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restore_resyncs_everyone() {
    let (address, state, _) = setup().await;
    let (mut a, _) = join(address, "u1", "Asha", "EDITOR").await;
    jd_collab::ws::access_changed(&state, &json!({ "workbookId": WB, "reload": true })).await;
    assert_eq!(next_of(&mut a, "resync").await["type"], "resync");
    assert!(matches!(next(&mut a).await, Message::Binary(_)));
}

/// P3-PERF-01: with 20 people editing at once, a change reaches the others within 300 ms at the
/// 95th percentile (local network; storage is the in-memory fake, so this measures the service).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn twenty_editors_see_changes_within_300_ms() {
    let (address, _, _) = setup().await;
    let mut editors = Vec::new();
    for i in 0..20 {
        editors.push(join(address, &format!("p{i}"), &format!("P{i}"), "EDITOR").await.0);
    }
    // Everyone listens; each change's delay is measured from send to arrival at each other person.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(String, std::time::Instant)>();
    let mut sinks = Vec::new();
    for (i, ws) in editors.into_iter().enumerate() {
        let (sink, mut stream) = ws.split();
        let tx = tx.clone();
        tokio::spawn(async move {
            while let Some(Ok(Message::Text(text))) = stream.next().await {
                let v: Value = serde_json::from_str(text.as_str()).unwrap_or(Value::Null);
                if v["type"] == "applied" && v["clientCommandId"].is_null() {
                    let input = v["step"]["params"]["input"].as_str().unwrap_or_default().to_string();
                    let _ = tx.send((format!("{input}@{i}"), std::time::Instant::now()));
                }
            }
        });
        sinks.push(sink);
    }
    let mut sent_at = HashMap::new();
    let rounds = 10;
    for round in 0..rounds {
        for (i, sink) in sinks.iter_mut().enumerate() {
            let input = format!("r{round}p{i}");
            sent_at.insert(input.clone(), std::time::Instant::now());
            let message = json!({ "type": "command", "clientCommandId": format!("c{round}-{i}"), "baseSeq": 0, "step": step(&format!("A{}", i + 1), &input) });
            sink.send(Message::Text(message.to_string().into())).await.unwrap();
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let expected = rounds * 20 * 19;
    let mut delays = Vec::new();
    while delays.len() < expected {
        let Ok(Some((key, at))) = tokio::time::timeout(Duration::from_secs(10), rx.recv()).await else {
            break;
        };
        let input = key.split('@').next().unwrap();
        if let Some(sent) = sent_at.get(input) {
            delays.push(at.duration_since(*sent).as_millis());
        }
    }
    assert_eq!(delays.len(), expected, "every change reached every other person");
    delays.sort_unstable();
    let p95 = delays[delays.len() * 95 / 100];
    println!(
        "P3-PERF-01: {} deliveries, median {} ms, p95 {} ms, max {} ms",
        delays.len(),
        delays[delays.len() / 2],
        p95,
        delays[delays.len() - 1]
    );
    assert!(p95 < 300, "95th percentile {p95} ms");
}

// --- P4-LOAD-03: the memory guard ---------------------------------------------------------------

const WB2: &str = "0190f5e0-0000-7000-8000-00000000000b";
const MB: u64 = 1024 * 1024;

async fn setup_with_memory(probe: jd_collab::memory::FixedProbe) -> (SocketAddr, AppState, Shared) {
    let shared: Shared = Arc::new(Mutex::new(FakeApp {
        version: "0190f5e0-0000-7000-8000-000000000001".into(),
        bytes: jd_collab::engine::blank_workbook().unwrap(),
        ..FakeApp::default()
    }));
    let app_url = fake_app(shared.clone()).await;
    let vars: HashMap<String, String> = [
        ("APP_ENV", "test"),
        ("COLLAB_PORT", "47331"),
        ("DATABASE_URL", "postgresql://u:p@127.0.0.1:47322/jdsheets_test"),
        ("COLLAB_TOKEN_SECRET", SECRET),
        ("INTERNAL_SERVICE_TOKEN", TOKEN),
        ("APP_INTERNAL_URL", app_url.as_str()),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    let state = AppState::with_memory(Config::from_env(&vars).unwrap(), Arc::new(probe));
    let app = router(state.clone()).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (address, state, shared)
}

async fn connect_to(address: SocketAddr, wb: &str, user: &str) -> Ws {
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{address}/collab/{wb}"))
        .await
        .unwrap();
    let t = token(user, user, "EDITOR", wb, "127.0.0.1", now());
    ws.send(Message::Text(json!({ "type": "auth", "token": t }).to_string().into()))
        .await
        .unwrap();
    ws
}

async fn wait_for_rooms(state: &AppState, count: usize) {
    for _ in 0..50 {
        if state.rooms.count().await == count {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(state.rooms.count().await, count);
}

#[tokio::test(flavor = "multi_thread")]
async fn below_the_mark_workbooks_open_as_usual() {
    let probe = jd_collab::memory::FixedProbe::new(100 * MB, 768 * MB);
    let (address, state, _) = setup_with_memory(probe).await;
    let (_a, _) = join(address, "u1", "Asha", "EDITOR").await;
    let mut b = connect_to(address, WB2, "u2").await;
    next_of(&mut b, "welcome").await;
    assert_eq!(state.rooms.count().await, 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn near_the_limit_an_idle_workbook_is_unloaded_first_after_saving_its_version() {
    let probe = jd_collab::memory::FixedProbe::new(100 * MB, 768 * MB);
    let (address, state, shared) = setup_with_memory(probe.clone()).await;
    {
        let (mut a, _) = join(address, "u1", "Asha", "EDITOR").await;
        send(
            &mut a,
            json!({ "type": "command", "clientCommandId": "a-1", "baseSeq": 0, "step": step("B2", "42") }),
        )
        .await;
        next_of(&mut a, "applied").await;
        a.close(None).await.unwrap();
    }
    probe.set_used(700 * MB);
    let mut b = connect_to(address, WB2, "u2").await;
    next_of(&mut b, "welcome").await;
    wait_for_rooms(&state, 1).await;
    assert!(
        shared.lock().unwrap().snapshots >= 1,
        "the idle workbook's changes were saved as a version before it was unloaded"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn near_the_limit_with_nothing_idle_a_new_workbook_is_refused_and_open_ones_keep_working() {
    let probe = jd_collab::memory::FixedProbe::new(100 * MB, 768 * MB);
    let (address, state, _) = setup_with_memory(probe.clone()).await;
    let (mut a, _) = join(address, "u1", "Asha", "EDITOR").await;
    probe.set_used(700 * MB);
    let mut b = connect_to(address, WB2, "u2").await;
    assert_eq!(
        closed_with(&mut b).await,
        1011,
        "busy: the page falls back to one editor at a time"
    );
    assert_eq!(state.rooms.count().await, 1);
    // The open workbook is never dropped, and others can still join it.
    send(
        &mut a,
        json!({ "type": "command", "clientCommandId": "a-1", "baseSeq": 0, "step": step("B2", "1") }),
    )
    .await;
    next_of(&mut a, "applied").await;
    let (_c, _) = join(address, "u3", "Chitra", "EDITOR").await;
}
