//! Live co-editing on the server (Phase 3, Decisions 22, 56, 58): GridCraft's live session for one
//! workbook. Steps travel as JSON; nothing outside this module sees GridCraft's types.
use std::sync::Arc;

use gridcraft_engine::live::{self, LiveRole, LiveStep, Refusal, Server};
use gridcraft_model::Workbook;
use serde_json::Value;

use super::{EngineFailure, open_xlsx, to_xlsx};
use crate::config::Limits;

/// What a person may change, from their token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Editor,
    Commenter,
    Viewer,
}

/// Why a step was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rejection {
    /// The person's role doesn't allow it.
    NotAllowed,
    /// It no longer fits (its cells or sheet were deleted, or it is too old): the sender resyncs.
    Stale,
    /// The command refused (for example a protected sheet).
    Refused(String),
    /// Not a step at all.
    Malformed,
}

impl Rejection {
    pub fn as_str(&self) -> &'static str {
        match self {
            Rejection::NotAllowed => "not-allowed",
            Rejection::Stale => "stale",
            Rejection::Refused(_) => "refused",
            Rejection::Malformed => "malformed",
        }
    }
}

/// The workbook at one moment, to go back to if storing a change fails.
pub struct Snapshot(Arc<Workbook>);

/// A change already stored, to replay when a session is loaded again (recovery).
pub struct StoredOp {
    pub seq: u64,
    pub step: Value,
}

/// One workbook's live session.
pub struct LiveDoc {
    server: Server,
}

impl LiveDoc {
    /// Loads the workbook from its current version's bytes and replays the changes stored on it.
    pub fn load(bytes: &[u8], limits: &Limits, replay: &[StoredOp], last_seq: u64) -> Result<LiveDoc, EngineFailure> {
        let wb = open_xlsx(bytes, limits)?;
        let mut server = Server::new(wb, 0);
        for op in replay {
            if let Ok(step) = serde_json::from_value::<LiveStep>(op.step.clone()) {
                // A stored change was accepted once; if it no longer applies, it is skipped.
                let _ = live::apply(&mut server.session, &step);
            }
            server.seq = op.seq;
        }
        server.seq = server.seq.max(last_seq);
        Ok(LiveDoc { server })
    }

    pub fn seq(&self) -> u64 {
        self.server.seq
    }

    pub fn seen(&self, user: &str, client_command_id: &str) -> bool {
        self.server.seen(user, client_command_id)
    }

    /// Checks, shifts and applies a step. Answers its sequence number, the step as applied, and
    /// its command id.
    #[allow(clippy::too_many_arguments)]
    pub fn submit(
        &mut self,
        user: &str,
        author: &str,
        role: Role,
        client_command_id: &str,
        base_seq: u64,
        step: &Value,
    ) -> Result<(u64, Value, String), Rejection> {
        let step: LiveStep = serde_json::from_value(step.clone()).map_err(|_| Rejection::Malformed)?;
        let role = match role {
            Role::Editor => LiveRole::Editor,
            Role::Commenter => LiveRole::Commenter,
            Role::Viewer => LiveRole::Viewer,
        };
        let (seq, applied) = self
            .server
            .submit(user, author, role, client_command_id, base_seq, &step)
            .map_err(|refusal| match refusal {
                Refusal::NotAllowed => Rejection::NotAllowed,
                Refusal::Stale => Rejection::Stale,
                Refusal::Refused(why) => Rejection::Refused(why),
            })?;
        let id = applied.id.clone();
        let json = serde_json::to_value(&applied).map_err(|_| Rejection::Malformed)?;
        Ok((seq, json, id))
    }

    pub fn snapshot(&self) -> Option<Snapshot> {
        self.server.workbook().map(Snapshot)
    }

    /// Takes the last accepted step back out (storing it failed).
    pub fn rollback(&mut self, to: Snapshot) {
        self.server.undo_last(to.0);
    }

    /// The workbook now, as XLSX bytes written by GridCraft.
    pub fn xlsx(&self) -> Result<Vec<u8>, EngineFailure> {
        let wb = self.server.workbook().ok_or(EngineFailure::Unreadable)?;
        to_xlsx(&wb)
    }
}
