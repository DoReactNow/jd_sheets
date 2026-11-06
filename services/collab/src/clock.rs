//! The only source of "now" (Decision 25). Tests use [`FixedClock`].
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub trait Clock: Send + Sync {
    /// Seconds since the Unix epoch.
    fn now_unix(&self) -> u64;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_unix(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }
}

/// A clock that only moves when the test moves it.
#[derive(Debug, Default)]
pub struct FixedClock(AtomicU64);

impl FixedClock {
    pub fn at(unix: u64) -> Self {
        Self(AtomicU64::new(unix))
    }
    pub fn set(&self, unix: u64) {
        self.0.store(unix, Ordering::SeqCst);
    }
    pub fn advance(&self, seconds: u64) {
        self.0.fetch_add(seconds, Ordering::SeqCst);
    }
}

impl Clock for FixedClock {
    fn now_unix(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_clock_moves_only_when_told() {
        let clock = FixedClock::at(100);
        assert_eq!(clock.now_unix(), 100);
        clock.advance(5);
        assert_eq!(clock.now_unix(), 105);
        clock.set(7);
        assert_eq!(clock.now_unix(), 7);
    }

    #[test]
    fn system_clock_is_after_2026() {
        assert!(SystemClock.now_unix() > 1_767_225_600);
    }
}
