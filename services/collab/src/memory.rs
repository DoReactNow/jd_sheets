//! How much memory the service uses, against its container limit (P4-LOAD-03, Decision 61).
//! Read from cgroup v2 in the container; tests give fixed numbers instead.
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

/// Above this share of the limit, idle workbooks are unloaded first, and if none can be, no
/// new workbook is opened (the page falls back to one editor at a time).
pub const HIGH_WATER_PERCENT: u64 = 80;

pub trait MemoryProbe: Send + Sync {
    /// Bytes in use now, or None when it cannot be read.
    fn used_bytes(&self) -> Option<u64>;
    /// The limit, or None when there is none.
    fn limit_bytes(&self) -> Option<u64>;
}

/// True when both numbers are known and use is at or above the high-water mark.
pub fn over_high_water(probe: &dyn MemoryProbe) -> bool {
    match (probe.used_bytes(), probe.limit_bytes()) {
        (Some(used), Some(limit)) if limit > 0 => used.saturating_mul(100) >= limit.saturating_mul(HIGH_WATER_PERCENT),
        _ => false,
    }
}

/// The container's cgroup v2 files (`mem_limit` in docker-compose.prod.yml sets memory.max).
pub struct CgroupProbe;

fn read_number(path: &str) -> Option<u64> {
    std::fs::read_to_string(path).ok()?.trim().parse().ok()
}

impl MemoryProbe for CgroupProbe {
    fn used_bytes(&self) -> Option<u64> {
        read_number("/sys/fs/cgroup/memory.current")
    }
    fn limit_bytes(&self) -> Option<u64> {
        // "max" (no limit) does not parse, which is the same as no limit.
        read_number("/sys/fs/cgroup/memory.max")
    }
}

/// Fixed numbers for tests; `used` can be changed while the service runs.
#[derive(Clone, Default)]
pub struct FixedProbe {
    pub used: Arc<AtomicU64>,
    pub limit: u64,
}

impl FixedProbe {
    pub fn new(used: u64, limit: u64) -> FixedProbe {
        FixedProbe {
            used: Arc::new(AtomicU64::new(used)),
            limit,
        }
    }
    pub fn set_used(&self, used: u64) {
        self.used.store(used, Ordering::Relaxed);
    }
}

impl MemoryProbe for FixedProbe {
    fn used_bytes(&self) -> Option<u64> {
        Some(self.used.load(Ordering::Relaxed))
    }
    fn limit_bytes(&self) -> Option<u64> {
        Some(self.limit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mark_is_eighty_percent_of_a_known_limit() {
        assert!(!over_high_water(&FixedProbe::new(79, 100)));
        assert!(over_high_water(&FixedProbe::new(80, 100)));
        assert!(over_high_water(&FixedProbe::new(120, 100)));
    }

    struct Unknown;
    impl MemoryProbe for Unknown {
        fn used_bytes(&self) -> Option<u64> {
            None
        }
        fn limit_bytes(&self) -> Option<u64> {
            None
        }
    }

    #[test]
    fn unknown_numbers_or_no_limit_never_block() {
        assert!(!over_high_water(&Unknown));
        assert!(!over_high_water(&FixedProbe::new(10, 0)));
    }
}
