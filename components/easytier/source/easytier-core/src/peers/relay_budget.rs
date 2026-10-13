//! Strict instance-wide admission for same-network forwarded data only.
//! No sleeps, queued packets, peer-specific buckets or audio dependencies.

use std::{
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

const NANOS_PER_SECOND: u128 = 1_000_000_000;
const BURST_DIVISOR: u64 = 4; // At most 250 ms of configured bytes/second.
pub(crate) const MAX_MEMBER_RELAY_LEASE_MS: u32 = 15_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RelayBudgetDecision {
    Legacy,
    Admitted,
    Dropped,
}

/// Managed same-network relay admission must not inherit the foreign-network
/// whitelist preference. Legacy instances keep their original advertisement.
pub(crate) fn advertised_avoid_relay_data(
    rate: Option<u64>,
    disabled: bool,
    legacy_preference: bool,
    lease_active: bool,
) -> bool {
    disabled
        || match rate {
            None => legacy_preference,
            Some(0) => true,
            Some(_) => !lease_active,
        }
}

/// Local injection with a local source is exempt. A remote peer cannot claim
/// exemption merely by setting the packet's source ID to this instance.
pub(crate) fn charges_forwarded_data(
    local_ingress: bool,
    local_source: bool,
    local_destination: bool,
    data: bool,
) -> bool {
    data && !local_destination && !(local_ingress && local_source)
}

#[derive(Default)]
pub(crate) struct MemberRelayBudget {
    state: Mutex<BucketState>,
    stopped: AtomicBool,
    lease_revoked: AtomicBool,
}

#[derive(Default)]
struct BucketState {
    initialized: bool,
    rate: Option<u64>,
    available: u64,
    remainder: u64,
    last: Option<Instant>,
    lease_deadline: Option<Instant>,
}

impl MemberRelayBudget {
    pub(crate) fn try_admit(&self, rate: Option<u64>, bytes: u64) -> RelayBudgetDecision {
        self.try_admit_at(rate, bytes, Instant::now())
    }

    fn try_admit_at(&self, rate: Option<u64>, bytes: u64, now: Instant) -> RelayBudgetDecision {
        if self.stopped.load(Ordering::Acquire) {
            return RelayBudgetDecision::Dropped;
        }
        // Absence is legacy behavior, including when a concurrent reader owns
        // the bucket. It is not a revoke operation; revoke must use zero/stop.
        if rate.is_none() {
            if let Ok(mut state) = self.state.try_lock() {
                let deadline = state.lease_deadline;
                *state = BucketState {
                    initialized: true,
                    lease_deadline: deadline,
                    ..Default::default()
                };
            }
            return RelayBudgetDecision::Legacy;
        }
        let Ok(mut state) = self.state.try_lock() else {
            return RelayBudgetDecision::Dropped;
        };
        if self.stopped.load(Ordering::Acquire) {
            return RelayBudgetDecision::Dropped;
        }
        if rate == Some(0)
            || self.lease_revoked.load(Ordering::Acquire)
            || !state.lease_deadline.is_some_and(|deadline| now < deadline)
        {
            state.available = 0;
            state.remainder = 0;
            state.last = Some(now);
            state.initialized = true;
            state.rate = rate;
            self.lease_revoked.store(true, Ordering::Release);
            return RelayBudgetDecision::Dropped;
        }
        state.admit(rate, bytes, now)
    }

    pub(crate) fn renew_lease(&self, lease_ms: u32) -> Result<(), &'static str> {
        self.renew_lease_at(lease_ms, Instant::now())
    }

    fn renew_lease_at(&self, lease_ms: u32, now: Instant) -> Result<(), &'static str> {
        if lease_ms > MAX_MEMBER_RELAY_LEASE_MS {
            return Err("member relay lease exceeds 15000ms");
        }
        if lease_ms == 0 {
            self.revoke_lease();
            return Ok(());
        }
        if self.stopped.load(Ordering::Acquire) {
            return Err("member relay budget is stopped");
        }
        let Ok(mut state) = self.state.try_lock() else {
            return Err("member relay budget is busy");
        };
        if self.stopped.load(Ordering::Acquire) {
            return Err("member relay budget is stopped");
        }
        if self.lease_revoked.load(Ordering::Acquire)
            || !state.lease_deadline.is_some_and(|deadline| now < deadline)
        {
            state.available = 0;
            state.remainder = 0;
            state.last = Some(now);
        }
        state.lease_deadline = Some(now + Duration::from_millis(u64::from(lease_ms)));
        self.lease_revoked.store(false, Ordering::Release);
        Ok(())
    }

    pub(crate) fn revoke_lease(&self) {
        // Revoke never waits for the quota mutex; the atomic gate closes first.
        self.lease_revoked.store(true, Ordering::Release);
        if let Ok(mut state) = self.state.try_lock() {
            state.lease_deadline = None;
            state.available = 0;
            state.remainder = 0;
            state.initialized = true;
            state.last = Some(Instant::now());
        }
    }

    pub(crate) fn lease_remaining_ms(&self) -> u32 {
        if self.stopped.load(Ordering::Acquire) || self.lease_revoked.load(Ordering::Acquire) {
            return 0;
        }
        let Ok(state) = self.state.try_lock() else {
            return 0;
        };
        state.lease_deadline.map_or(0, |deadline| {
            deadline
                .saturating_duration_since(Instant::now())
                .as_millis()
                .min(u128::from(MAX_MEMBER_RELAY_LEASE_MS)) as u32
        })
    }

    pub(crate) fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        self.revoke_lease();
        if let Ok(mut state) = self.state.try_lock() {
            *state = BucketState::default();
        }
    }
}

impl BucketState {
    fn admit(&mut self, rate: Option<u64>, bytes: u64, now: Instant) -> RelayBudgetDecision {
        let Some(rate_value) = rate else {
            *self = Self {
                initialized: true,
                ..Default::default()
            };
            return RelayBudgetDecision::Legacy;
        };
        let capacity = rate_value / BURST_DIVISOR;
        if !self.initialized || self.rate != rate {
            // Only the very first configured use receives a starting burst.
            // Changes/re-enabling cannot mint another burst from old credit.
            self.available = if self.initialized { 0 } else { capacity };
            self.initialized = true;
            self.rate = rate;
            self.remainder = 0;
            self.last = Some(now);
        } else if let Some(last) = self.last {
            let Some(elapsed) = now.checked_duration_since(last) else {
                self.available = 0;
                self.remainder = 0;
                self.last = Some(now);
                return RelayBudgetDecision::Dropped;
            };
            let credit = u128::from(rate_value)
                .saturating_mul(elapsed.as_nanos())
                .saturating_add(u128::from(self.remainder));
            let generated = credit / NANOS_PER_SECOND;
            let room = capacity.saturating_sub(self.available);
            if generated >= u128::from(room) {
                self.available = capacity;
                self.remainder = 0;
            } else {
                self.available += generated as u64;
                self.remainder = (credit % NANOS_PER_SECOND) as u64;
            }
            self.last = Some(now);
        }
        // Zero denies; packets larger than the burst are never undercharged.
        if rate_value == 0 || bytes == 0 || bytes > self.available {
            return RelayBudgetDecision::Dropped;
        }
        self.available -= bytes;
        RelayBudgetDecision::Admitted
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Arc, thread, time::Duration};

    #[test]
    fn managed_advertisement_tracks_lease_zero_and_disable_without_foreign_whitelist() {
        assert!(!advertised_avoid_relay_data(
            Some(32_000),
            false,
            true,
            true
        ));
        assert!(advertised_avoid_relay_data(
            Some(32_000),
            false,
            false,
            false
        ));
        assert!(advertised_avoid_relay_data(Some(0), false, false, true));
        assert!(advertised_avoid_relay_data(Some(32_000), true, false, true));
        for preference in [false, true] {
            for lease in [false, true] {
                assert_eq!(
                    advertised_avoid_relay_data(None, false, preference, lease),
                    preference
                );
                assert!(advertised_avoid_relay_data(None, true, preference, lease));
            }
        }
        let budget = MemberRelayBudget::default();
        let start = Instant::now();
        budget.renew_lease_at(10_000, start).unwrap();
        assert!(budget.lease_remaining_ms() > 0);
        assert_eq!(
            budget.try_admit_at(Some(32_000), 1, start + Duration::from_millis(10_000)),
            RelayBudgetDecision::Dropped
        );
        assert_eq!(budget.lease_remaining_ms(), 0);
        assert!(advertised_avoid_relay_data(
            Some(32_000),
            false,
            true,
            budget.lease_remaining_ms() > 0
        ));
    }

    #[test]
    fn local_data_and_all_control_bypass_even_when_stopped() {
        for local_ingress in [false, true] {
            for local_source in [false, true] {
                assert!(!charges_forwarded_data(
                    local_ingress,
                    local_source,
                    false,
                    false
                ));
                assert!(!charges_forwarded_data(
                    local_ingress,
                    local_source,
                    true,
                    true
                ));
            }
        }
        assert!(!charges_forwarded_data(true, true, false, true));
        assert!(charges_forwarded_data(false, false, false, true));
        assert!(charges_forwarded_data(false, true, false, true));
        assert!(charges_forwarded_data(true, false, false, true));
        let budget = MemberRelayBudget::default();
        budget.stop();
        assert_eq!(budget.try_admit(None, 1), RelayBudgetDecision::Dropped);
        // Router invokes the stopped bucket only for charges_forwarded_data.
    }

    #[test]
    fn missing_config_is_legacy_zero_denies_and_stop_fails_closed() {
        let budget = MemberRelayBudget::default();
        assert_eq!(
            budget.try_admit(None, u64::MAX),
            RelayBudgetDecision::Legacy
        );
        assert_eq!(budget.try_admit(Some(0), 1), RelayBudgetDecision::Dropped);
        budget.stop();
        assert_eq!(
            budget.try_admit(Some(32_000), 1),
            RelayBudgetDecision::Dropped
        );
    }

    #[test]
    fn complete_bytes_across_destinations_share_one_strict_burst() {
        let now = Instant::now();
        let mut state = BucketState::default();
        assert_eq!(
            state.admit(Some(32_000), 4_000, now),
            RelayBudgetDecision::Admitted
        );
        assert_eq!(
            state.admit(Some(32_000), 4_000, now),
            RelayBudgetDecision::Admitted
        );
        assert_eq!(
            state.admit(Some(32_000), 1, now),
            RelayBudgetDecision::Dropped
        );
        assert_eq!(
            state.admit(Some(32_000), 4_000, now + Duration::from_millis(125)),
            RelayBudgetDecision::Admitted
        );
        assert_eq!(
            state.admit(Some(32_000), 8_001, now + Duration::from_secs(1)),
            RelayBudgetDecision::Dropped
        );
        assert_eq!(state.available, 8_000);
    }

    #[test]
    fn fraction_carry_and_long_idle_credit_are_bounded() {
        let start = Instant::now();
        let mut state = BucketState::default();
        assert_eq!(
            state.admit(Some(100), 25, start),
            RelayBudgetDecision::Admitted
        );
        for step in 1..=10 {
            state.admit(
                Some(100),
                u64::MAX,
                start + Duration::from_millis(step * 15),
            );
        }
        assert_eq!(state.available, 15);
        state.admit(Some(100), u64::MAX, start + Duration::from_secs(1_000));
        assert_eq!(state.available, 25);
        assert_eq!(state.remainder, 0);
    }

    #[test]
    fn zero_reenable_and_rate_change_discard_prior_credit() {
        let start = Instant::now();
        let mut state = BucketState::default();
        assert_eq!(
            state.admit(Some(32_000), 1, start),
            RelayBudgetDecision::Admitted
        );
        assert_eq!(state.admit(Some(0), 1, start), RelayBudgetDecision::Dropped);
        assert_eq!(
            state.admit(Some(32_000), 1, start),
            RelayBudgetDecision::Dropped
        );
        assert_eq!(
            state.admit(Some(32_000), 4_000, start + Duration::from_millis(125)),
            RelayBudgetDecision::Admitted
        );
        assert_eq!(
            state.admit(Some(64_000), 1, start + Duration::from_millis(125)),
            RelayBudgetDecision::Dropped
        );
        state.admit(None, 1, start);
        assert_eq!(
            state.admit(Some(32_000), 1, start),
            RelayBudgetDecision::Dropped
        );
    }

    #[test]
    fn clock_regression_clears_credit_and_large_rates_do_not_overflow() {
        let start = Instant::now();
        let mut state = BucketState::default();
        state.admit(Some(u64::MAX), 1, start + Duration::from_secs(1));
        assert_eq!(
            state.admit(Some(u64::MAX), 1, start),
            RelayBudgetDecision::Dropped
        );
        assert_eq!(state.available, 0);
        state.admit(
            Some(u64::MAX),
            u64::MAX,
            start + Duration::from_secs(10_000),
        );
        assert_eq!(state.available, u64::MAX / 4);
    }

    #[test]
    fn contention_drops_instead_of_waiting_or_queueing() {
        let budget = Arc::new(MemberRelayBudget::default());
        let guard = budget.state.lock().unwrap();
        let concurrent = budget.clone();
        assert_eq!(
            thread::spawn(move || concurrent.try_admit(Some(32_000), 1))
                .join()
                .unwrap(),
            RelayBudgetDecision::Dropped
        );
        assert_eq!(budget.try_admit(None, 1), RelayBudgetDecision::Legacy);
        budget.stop();
        assert_eq!(
            budget.try_admit(Some(32_000), 1),
            RelayBudgetDecision::Dropped
        );
        drop(guard);
    }

    #[test]
    fn configured_budget_requires_short_native_lease_and_expiry_does_not_need_main() {
        let budget = MemberRelayBudget::default();
        let start = Instant::now();
        assert_eq!(
            budget.try_admit_at(Some(32_000), 1, start),
            RelayBudgetDecision::Dropped
        );
        budget.renew_lease_at(10_000, start).unwrap();
        assert_eq!(
            budget.try_admit_at(Some(32_000), 4_000, start + Duration::from_millis(125)),
            RelayBudgetDecision::Admitted
        );
        assert_eq!(
            budget.try_admit_at(Some(32_000), 1, start + Duration::from_millis(10_000)),
            RelayBudgetDecision::Dropped
        );
        assert_eq!(
            budget.try_admit_at(Some(32_000), 1, start + Duration::from_secs(30)),
            RelayBudgetDecision::Dropped
        );
        assert_eq!(
            budget.try_admit_at(None, 1, start + Duration::from_secs(30)),
            RelayBudgetDecision::Legacy
        );
    }

    #[test]
    fn renewal_is_bounded_zero_revokes_and_missing_renewal_cannot_extend_deadline() {
        let budget = MemberRelayBudget::default();
        let start = Instant::now();
        assert!(budget.renew_lease_at(15_001, start).is_err());
        budget.renew_lease_at(10_000, start).unwrap();
        assert_eq!(
            budget.try_admit_at(Some(32_000), 8_000, start),
            RelayBudgetDecision::Admitted
        );
        budget
            .renew_lease_at(10_000, start + Duration::from_secs(5))
            .unwrap();
        assert_eq!(
            budget.try_admit_at(Some(32_000), 8_000, start + Duration::from_secs(11)),
            RelayBudgetDecision::Admitted
        );
        assert_eq!(
            budget.try_admit_at(Some(32_000), 1, start + Duration::from_secs(15)),
            RelayBudgetDecision::Dropped
        );
        budget
            .renew_lease_at(10_000, start + Duration::from_secs(15))
            .unwrap();
        budget.renew_lease(0).unwrap();
        assert_eq!(
            budget.try_admit_at(Some(32_000), 1, start + Duration::from_secs(16)),
            RelayBudgetDecision::Dropped
        );
    }
}
