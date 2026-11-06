//! The `postMessage` bridge to a same-origin parent page (`?host=parent`), for pages that embed
//! GridCraft in an `<iframe>` (such as a Nextcloud app). Messages are plain objects with a `type`:
//!
//! - `gridcraft:ready` (to the parent): `{ version }`, the app is listening; send a file now.
//! - `gridcraft:open` (from the parent): `{ name, bytes }`, bytes an `ArrayBuffer` or
//!   `Uint8Array`. It opens like a workbook picked with File › Open or dropped on the window.
//! - `gridcraft:save` (to the parent): `{ name, bytes }` (a transferred `ArrayBuffer`) for every
//!   file GridCraft would otherwise download: Save and Save As (an .xlsx workbook) and Export
//!   as PDF. The parent stores it and reports failures itself.
//! - `gridcraft:dirty` (to the parent): `{ dirty }` whenever unsaved changes appear or go away.
//! - `gridcraft:failed` (to the parent): `{ error }` when the app couldn't start.
//! - `gridcraft:mode` (from the parent): `{ mode }`, `view`, `comment` or `edit`, applied at once
//!   (`?mode=` sets it on load; see the `access` module). In view mode Save hands nothing over.
//! - `gridcraft:saveNow` (from the parent): save as File › Save would, for a parent that saves
//!   by itself (autosave). Ignored in view mode.
//! - Live co-editing (JD Sheets, Decisions 22, 56): `gridcraft:live { seq }` (from the parent)
//!   starts it after the workbook is open; then every change this person makes goes to the parent
//!   as `gridcraft:command { clientCommandId, step }` (the step as JSON text), and the parent sends
//!   what the server ordered as `gridcraft:apply { message }` (JSON text of
//!   `gridcraft_engine::live::Incoming`). `gridcraft:resync { name, bytes, seq }` replaces the
//!   workbook with the server's; `gridcraft:resyncNeeded` (to the parent) asks for one.
//!
//! Only the parent window on the page's own origin is heard or answered. In host mode the page
//! starts with an empty workbook instead of a sample, and the parent guards leaving the page.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gridcraft_ui_egui::{Inbox, Services, SheetApp};

use gridcraft_engine::live::{self, Client, Incoming, Outcome};

use crate::access::{Gate, Mode};

/// Live co-editing messages from the parent, handled after the next frame.
enum LiveMessage {
    Start { seq: u64 },
    Message(Incoming),
    Resync { name: String, bytes: Vec<u8>, seq: u64 },
}
use wasm_bindgen::JsCast as _;
use wasm_bindgen::JsValue;
use wasm_bindgen::closure::Closure;

/// Saving one of these hands the whole workbook to the parent, which stores it: the workbook
/// counts as saved under that name, as it would after Save on the desktop.
const WORKBOOK_EXTS: &[&str] = &["xlsx"];

/// The longest user name taken from `?author=`.
const MAX_AUTHOR_CHARS: usize = 200;

#[derive(Clone)]
pub struct Bridge {
    window: web_sys::Window,
    parent: web_sys::Window,
    origin: String,
    /// Names of the files handed to the parent since the last frame.
    saved: Rc<RefCell<Vec<String>>>,
    /// The unsaved-changes state last reported to the parent.
    reported: Rc<Cell<Option<bool>>>,
    /// The access mode and what it last allowed.
    gate: Rc<RefCell<Gate>>,
    /// A mode the parent asked for, applied after the next frame.
    next_mode: Rc<Cell<Option<Mode>>>,
    /// The parent asked for a save.
    save_now: Rc<Cell<bool>>,
    /// Live co-editing: messages waiting, and the editor's side once started.
    live_inbox: Rc<RefCell<Vec<LiveMessage>>>,
    live: Rc<RefCell<Option<Client>>>,
}

impl Bridge {
    /// `None` when the page isn't framed (there is no parent to talk to).
    pub fn new() -> Option<Self> {
        let window = web_sys::window()?;
        let parent = window.parent().ok().flatten()?;
        if js_sys::Object::is(&parent, &window) {
            return None;
        }
        let origin = window.location().origin().ok()?;
        let mode = window
            .location()
            .search()
            .ok()
            .and_then(|search| web_sys::UrlSearchParams::new_with_str(&search).ok())
            .and_then(|params| params.get("mode"))
            .and_then(|mode| Mode::parse(&mode))
            .unwrap_or_default();
        Some(Self {
            window,
            parent,
            origin,
            saved: Rc::default(),
            reported: Rc::default(),
            gate: Rc::new(RefCell::new(Gate::new(mode))),
            next_mode: Rc::default(),
            save_now: Rc::default(),
            live_inbox: Rc::default(),
            live: Rc::default(),
        })
    }

    /// Send saved and exported files to the parent instead of downloading them, and hear files
    /// from it.
    pub fn connect(&self, services: &mut Services, inbox: Inbox, ctx: egui::Context) {
        self.listen(inbox, ctx);
        let bridge = self.clone();
        services.download = Some(Box::new(move |name: &str, bytes: &[u8]| {
            if let Err(e) = bridge.post_save(name, bytes) {
                log::error!("couldn't hand {name} to the page: {e}");
            }
        }));
    }

    /// `?author=`: the host's name for the user signs new notes and comments.
    pub fn set_author(app: &mut SheetApp, author: &str) {
        let author: String = author.trim().chars().take(MAX_AUTHOR_CHARS).collect();
        if !author.is_empty() {
            app.session.prefs.user_name = author;
        }
    }

    pub fn post_ready(&self) {
        self.send(&[("type", "gridcraft:ready".into()), ("version", env!("CARGO_PKG_VERSION").into())]);
    }

    pub fn post_failed(&self, error: &str) {
        self.send(&[("type", "gridcraft:failed".into()), ("error", error.into())]);
    }

    /// After each frame: a workbook handed to the parent this frame counts as saved under the
    /// name it was saved as, and the parent hears when unsaved changes appear or go away.
    pub fn sync(&self, app: &mut SheetApp) {
        if let Some(mode) = self.next_mode.take() {
            self.gate.borrow_mut().set_mode(mode);
        }
        let reverted = self.gate.borrow_mut().enforce(app);
        self.sync_live(app, reverted);
        if self.save_now.take() && self.gate.borrow().mode().saves() {
            app.open_dialog("saveAs", serde_json::json!({}));
        }
        let saved = std::mem::take(&mut *self.saved.borrow_mut());
        if let Some(name) = saved.iter().rev().find(|name| is_workbook(name))
            && let Some(doc) = app.session.active_mut()
        {
            doc.saved = doc.wb.clone();
            if doc.path.is_none() {
                doc.title = name.clone();
            }
        }
        let dirty = app.session.documents().iter().any(|d| d.is_dirty());
        if self.reported.get() != Some(dirty) && self.send(&[("type", "gridcraft:dirty".into()), ("dirty", dirty.into())]) {
            self.reported.set(Some(dirty));
        }
    }

    /// Live co-editing after each frame: this person's changes go out, the server's come in.
    fn sync_live(&self, app: &mut SheetApp, reverted: bool) {
        let queued = std::mem::take(&mut *self.live_inbox.borrow_mut());
        let mut incoming = Vec::new();
        for message in queued {
            match message {
                LiveMessage::Start { seq } => {
                    app.session.start_live();
                    let prefix = format!("{:x}", (js_sys::Math::random() * 1e15) as u64);
                    let mut client = Client::new(&prefix, seq);
                    client.end_frame(&app.session);
                    *self.live.borrow_mut() = Some(client);
                }
                LiveMessage::Resync { name, bytes, seq } => {
                    if let Ok((wb, _)) = gridcraft_engine::io::open_bytes(&name, &bytes) {
                        let _ = live::replace(&mut app.session, wb);
                    }
                    let _ = app.session.take_live_steps();
                    if let Some(client) = self.live.borrow_mut().as_mut() {
                        client.resynced(&app.session, seq);
                    }
                    incoming.clear();
                }
                LiveMessage::Message(m) => incoming.push(m),
            }
        }
        let mut live = self.live.borrow_mut();
        let Some(client) = live.as_mut() else { return };
        // A change the mode put back is never sent (view mode sends nothing).
        if reverted || self.gate.borrow().mode() == Mode::View {
            let _ = app.session.take_live_steps();
        } else {
            for (id, step) in client.outgoing(&mut app.session) {
                if let Ok(text) = serde_json::to_string(&step) {
                    self.send(&[("type", "gridcraft:command".into()), ("clientCommandId", id.as_str().into()), ("step", text.as_str().into())]);
                }
            }
        }
        for message in &incoming {
            if client.receive(&mut app.session, message) == Outcome::NeedResync {
                self.send(&[("type", "gridcraft:resyncNeeded".into())]);
                break;
            }
        }
        // Others' changes are not this person's: the mode keeps them.
        self.gate.borrow_mut().accept(app);
        client.end_frame(&app.session);
    }

    fn post_save(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        let name = std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string());
        // In view mode a workbook is never handed over (exports such as PDF still are).
        if is_workbook(&name) && !self.gate.borrow().mode().saves() {
            return Ok(());
        }
        let buffer = js_sys::Uint8Array::from(bytes).buffer();
        let message = message(&[("type", "gridcraft:save".into()), ("name", name.as_str().into()), ("bytes", buffer.clone().into())])
            .ok_or_else(|| "couldn't build the message".to_string())?;
        self.parent
            .post_message_with_transfer(&message, &self.origin, &js_sys::Array::of1(&buffer))
            .map_err(|e| e.as_string().unwrap_or_else(|| format!("{e:?}")))?;
        self.saved.borrow_mut().push(name);
        Ok(())
    }

    fn listen(&self, inbox: Inbox, ctx: egui::Context) {
        let parent = self.parent.clone();
        let origin = self.origin.clone();
        let next_mode = self.next_mode.clone();
        let save_now = self.save_now.clone();
        let live_inbox = self.live_inbox.clone();
        let on_message = Closure::<dyn FnMut(web_sys::MessageEvent)>::new(move |event: web_sys::MessageEvent| {
            if event.origin() != origin || !event.source().is_some_and(|s| js_sys::Object::is(&s, &parent)) {
                return;
            }
            let data = event.data();
            match string(&data, "type").as_deref() {
                Some("gridcraft:open") => {}
                Some("gridcraft:mode") => {
                    if let Some(mode) = string(&data, "mode").and_then(|m| Mode::parse(&m)) {
                        next_mode.set(Some(mode));
                        ctx.request_repaint();
                    }
                    return;
                }
                Some("gridcraft:saveNow") => {
                    save_now.set(true);
                    ctx.request_repaint();
                    return;
                }
                Some("gridcraft:live") => {
                    let seq = number(&data, "seq").unwrap_or(0);
                    live_inbox.borrow_mut().push(LiveMessage::Start { seq });
                    ctx.request_repaint();
                    return;
                }
                Some("gridcraft:apply") => {
                    if let Some(m) = string(&data, "message").and_then(|t| serde_json::from_str::<Incoming>(&t).ok()) {
                        live_inbox.borrow_mut().push(LiveMessage::Message(m));
                        ctx.request_repaint();
                    }
                    return;
                }
                Some("gridcraft:resync") => {
                    let name = string(&data, "name").unwrap_or_else(|| "Book.xlsx".to_string());
                    if let Some(bytes) = bytes(&data) {
                        let seq = number(&data, "seq").unwrap_or(0);
                        live_inbox.borrow_mut().push(LiveMessage::Resync { name, bytes, seq });
                        ctx.request_repaint();
                    }
                    return;
                }
                _ => return,
            }
            let name = string(&data, "name").filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Book.xlsx".to_string());
            let Some(bytes) = bytes(&data) else { return };
            inbox.lock().unwrap_or_else(|e| e.into_inner()).push((name, bytes));
            ctx.request_repaint();
        });
        if self.window.add_event_listener_with_callback("message", on_message.as_ref().unchecked_ref()).is_ok() {
            // The listener lives as long as the page.
            on_message.forget();
        }
    }

    /// Post a message to the parent; false if it couldn't be sent.
    fn send(&self, fields: &[(&str, JsValue)]) -> bool {
        message(fields).is_some_and(|m| self.parent.post_message(&m, &self.origin).is_ok())
    }
}

fn is_workbook(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, ext)| WORKBOOK_EXTS.iter().any(|e| ext.eq_ignore_ascii_case(e)))
}

fn message(fields: &[(&str, JsValue)]) -> Option<js_sys::Object> {
    let m = js_sys::Object::new();
    for (key, value) in fields {
        js_sys::Reflect::set(&m, &JsValue::from_str(key), value).ok()?;
    }
    Some(m)
}

fn number(data: &JsValue, key: &str) -> Option<u64> {
    let n = js_sys::Reflect::get(data, &JsValue::from_str(key)).ok()?.as_f64()?;
    (n.is_finite() && n >= 0.0).then_some(n as u64)
}

fn string(data: &JsValue, key: &str) -> Option<String> {
    js_sys::Reflect::get(data, &JsValue::from_str(key)).ok()?.as_string()
}

/// `bytes` as an `ArrayBuffer` or `Uint8Array`.
fn bytes(data: &JsValue) -> Option<Vec<u8>> {
    let bytes = js_sys::Reflect::get(data, &JsValue::from_str("bytes")).ok()?;
    if let Some(array) = bytes.dyn_ref::<js_sys::Uint8Array>() {
        Some(array.to_vec())
    } else if bytes.is_instance_of::<js_sys::ArrayBuffer>() {
        Some(js_sys::Uint8Array::new(&bytes).to_vec())
    } else {
        None
    }
}
