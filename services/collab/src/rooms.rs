//! Live rooms (Phase 3, Decisions 22, 56, 58): one per open workbook, holding its live session,
//! the people connected, their presence, and what still needs saving as a version.
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::{Mutex, mpsc};
use tokio::time::Instant;

use crate::app_client::{AppClient, OpToStore};
use crate::config::Limits;
use crate::engine::live::{LiveDoc, Rejection, Role, StoredOp};

/// At most this many people editing one workbook at once (Decision 56); the next one views.
pub const MAX_EDITORS: usize = 25;
/// A version is saved this often while people edit, and when the last person leaves.
pub const SNAPSHOT_EVERY: Duration = Duration::from_secs(10 * 60);
/// A room nobody is in is unloaded after this long (P3-PERF-02).
pub const UNLOAD_AFTER: Duration = Duration::from_secs(10 * 60);

/// Stable presence colours (P3-PRES-01): the same person always gets the same one.
const COLOURS: [&str; 12] = [
    "#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#e377c2", "#8c564b", "#bcbd22", "#7f7f7f",
    "#393b79", "#637939",
];

pub fn colour_for(user_id: &str) -> &'static str {
    let hash = user_id
        .bytes()
        .fold(0u32, |h, b| h.wrapping_mul(31).wrapping_add(u32::from(b)));
    COLOURS[(hash as usize) % COLOURS.len()]
}

/// What a connection sends to its person.
#[derive(Debug, Clone)]
pub enum Out {
    Text(String),
    Binary(Vec<u8>),
    /// Close with a code and a reason the page understands.
    Close(u16, &'static str),
}

pub struct Conn {
    pub user_id: String,
    pub name: String,
    pub role: Role,
    pub selection: Option<Value>,
    pub tx: mpsc::UnboundedSender<Out>,
}

pub struct Room {
    pub workbook_id: String,
    pub doc: LiveDoc,
    /// The version the changes now being stored build on.
    pub base_version_id: String,
    pub conns: HashMap<u64, Conn>,
    pub dirty: bool,
    pub contributors: HashSet<String>,
    pub last_snapshot: Instant,
    pub empty_since: Option<Instant>,
}

/// Every open room, and how to reach the app.
pub struct Rooms {
    rooms: Mutex<HashMap<String, Arc<Mutex<Room>>>>,
    pub app: AppClient,
    pub limits: Limits,
    next_conn: std::sync::atomic::AtomicU64,
}

impl Rooms {
    pub fn new(app: AppClient, limits: Limits) -> Rooms {
        Rooms {
            rooms: Mutex::default(),
            app,
            limits,
            next_conn: Default::default(),
        }
    }

    pub fn next_conn_id(&self) -> u64 {
        self.next_conn.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    /// The room for a workbook, loaded from the app on first use (P3-RECOV-01).
    pub async fn open(&self, workbook_id: &str) -> Result<Arc<Mutex<Room>>, String> {
        let mut rooms = self.rooms.lock().await;
        if let Some(room) = rooms.get(workbook_id) {
            return Ok(room.clone());
        }
        let room = Arc::new(Mutex::new(self.load(workbook_id).await?));
        rooms.insert(workbook_id.to_string(), room.clone());
        Ok(room)
    }

    async fn load(&self, workbook_id: &str) -> Result<Room, String> {
        let state = self.app.state(workbook_id).await.map_err(|e| e.to_string())?;
        let bytes = self.app.content(workbook_id).await.map_err(|e| e.to_string())?;
        let replay: Vec<StoredOp> = state
            .ops
            .into_iter()
            .map(|op| StoredOp {
                seq: op.seq,
                step: op.step,
            })
            .collect();
        let limits = self.limits.clone();
        let last = state.last_seq;
        let doc = tokio::task::spawn_blocking(move || LiveDoc::load(&bytes, &limits, &replay, last))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        Ok(Room {
            workbook_id: workbook_id.to_string(),
            doc,
            base_version_id: state.version_id,
            conns: HashMap::new(),
            dirty: false,
            contributors: HashSet::new(),
            last_snapshot: Instant::now(),
            empty_since: None,
        })
    }

    /// All rooms (for the snapshot and unload loop, and access changes).
    pub async fn all(&self) -> Vec<Arc<Mutex<Room>>> {
        self.rooms.lock().await.values().cloned().collect()
    }

    pub async fn remove(&self, workbook_id: &str) {
        self.rooms.lock().await.remove(workbook_id);
    }

    /// Loads the room again from the app (a version was restored, P3-RESTORE-01) and sends
    /// everyone the new workbook.
    pub async fn reload(&self, room: &Arc<Mutex<Room>>) {
        let mut r = room.lock().await;
        match self.load(&r.workbook_id.clone()).await {
            Ok(fresh) => {
                r.doc = fresh.doc;
                r.base_version_id = fresh.base_version_id;
                r.dirty = false;
                r.contributors.clear();
                r.last_snapshot = Instant::now();
                broadcast_resync(&r);
            }
            Err(error) => tracing::error!(workbook = %r.workbook_id, %error, "could not reload a live workbook"),
        }
    }

    /// Saves the room as a "Live editing" version when it has unsaved changes (P3-SNAP-01..03).
    /// A failure keeps the changes for the next try (they are stored already).
    pub async fn snapshot(&self, room: &Arc<Mutex<Room>>) {
        let restored = {
            let mut r = room.lock().await;
            if !r.dirty {
                return;
            }
            let bytes = match tokio::task::block_in_place(|| r.doc.xlsx()) {
                Ok(bytes) => bytes,
                Err(error) => {
                    tracing::error!(workbook = %r.workbook_id, %error, "could not write a live snapshot");
                    return;
                }
            };
            let contributors: Vec<String> = r.contributors.iter().cloned().collect();
            match self
                .app
                .snapshot(&r.workbook_id, &r.base_version_id, &contributors, bytes)
                .await
            {
                Ok(version_id) => {
                    r.base_version_id = version_id;
                    r.dirty = false;
                    r.contributors.clear();
                    r.last_snapshot = Instant::now();
                    false
                }
                Err(crate::app_client::AppError::Status(409)) => true,
                Err(error) => {
                    tracing::warn!(workbook = %r.workbook_id, %error, "live snapshot failed; will retry");
                    false
                }
            }
        };
        if restored {
            // Someone restored a version meanwhile: that version wins; everyone reloads it.
            self.reload(room).await;
        }
    }

    /// Every 30 seconds: saves versions that are due, and unloads rooms nobody is in.
    pub async fn tick(&self) {
        for room in self.all().await {
            let (due, idle, id) = {
                let r = room.lock().await;
                let due = r.dirty && (r.last_snapshot.elapsed() >= SNAPSHOT_EVERY || r.conns.is_empty());
                let idle = r.conns.is_empty() && r.empty_since.is_some_and(|t| t.elapsed() >= UNLOAD_AFTER);
                (due, idle, r.workbook_id.clone())
            };
            if due {
                self.snapshot(&room).await;
            }
            if idle && !room.lock().await.dirty {
                self.remove(&id).await;
            }
        }
    }
}

/// What everyone in the room sees of each other (P3-PRES-*): one entry per person, names from
/// their tokens, a stable colour, and where they are.
pub fn presence(room: &Room) -> Value {
    let mut people: Vec<Value> = Vec::new();
    let mut seen = HashSet::new();
    for conn in room.conns.values() {
        if seen.insert(conn.user_id.clone()) {
            people.push(json!({
                "userId": conn.user_id,
                "name": conn.name,
                "colour": colour_for(&conn.user_id),
                "role": role_name(conn.role),
                "selection": room.conns.values().filter(|c| c.user_id == conn.user_id).find_map(|c| c.selection.clone()),
            }));
        }
    }
    people.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    json!({ "type": "presence", "people": people })
}

pub fn role_name(role: Role) -> &'static str {
    match role {
        Role::Editor => "EDITOR",
        Role::Commenter => "COMMENTER",
        Role::Viewer => "VIEWER",
    }
}

pub fn send_all(room: &Room, message: &Value) {
    let text = message.to_string();
    for conn in room.conns.values() {
        let _ = conn.tx.send(Out::Text(text.clone()));
    }
}

/// Sends everyone the workbook as it is now, with the sequence number.
pub fn broadcast_resync(room: &Room) {
    let Ok(bytes) = tokio::task::block_in_place(|| room.doc.xlsx()) else {
        return;
    };
    let head = json!({ "type": "resync", "seq": room.doc.seq() }).to_string();
    for conn in room.conns.values() {
        let _ = conn.tx.send(Out::Text(head.clone()));
        let _ = conn.tx.send(Out::Binary(bytes.clone()));
    }
}

/// How many different people are editing (P3-PERF-03).
pub fn editors(room: &Room, except_user: &str) -> usize {
    room.conns
        .values()
        .filter(|c| c.role == Role::Editor && c.user_id != except_user)
        .map(|c| c.user_id.as_str())
        .collect::<HashSet<_>>()
        .len()
}

/// Accepts one change from a person: checked, shifted and applied, stored by the app, then sent
/// to everyone (P3-ORDER-*, P3-REBASE-*, P3-ROLE-*). Nothing reaches anyone before it is stored.
pub async fn submit(
    app: &AppClient,
    room: &mut Room,
    conn_id: u64,
    client_command_id: &str,
    base_seq: u64,
    step: &Value,
) -> Result<(), Rejection> {
    let Some(conn) = room.conns.get(&conn_id) else {
        return Err(Rejection::NotAllowed);
    };
    let (user, name, role) = (conn.user_id.clone(), conn.name.clone(), conn.role);
    if room.doc.seen(&user, client_command_id) {
        return Ok(()); // a retry of a change already accepted (P3-ORDER-03)
    }
    let before = room.doc.snapshot();
    let (seq, applied, command_id) = room.doc.submit(&user, &name, role, client_command_id, base_seq, step)?;
    let op = OpToStore {
        seq,
        user_id: user.clone(),
        client_command_id: client_command_id.to_string(),
        command_id,
        step: applied.clone(),
    };
    if let Err(error) = app.store_ops(&room.workbook_id, &room.base_version_id, &[op]).await {
        tracing::error!(workbook = %room.workbook_id, %error, "could not store a live change");
        if let Some(before) = before {
            room.doc.rollback(before);
        }
        return Err(Rejection::Refused("unavailable".into()));
    }
    room.dirty = true;
    room.contributors.insert(user.clone());
    for (id, c) in &room.conns {
        let own = *id == conn_id;
        let message = json!({
            "type": "applied",
            "seq": seq,
            "clientCommandId": if own { Value::String(client_command_id.to_string()) } else { Value::Null },
            "step": applied,
        });
        let _ = c.tx.send(Out::Text(message.to_string()));
    }
    Ok(())
}
