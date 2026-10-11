//! Product-owned creation contract. Pure, with no open/session/OS capabilities.

pub(crate) fn create_verified_adapter<A, E>(
    requested_guid: u128,
    create: impl FnOnce(u128) -> Result<A, E>,
    actual_guid: impl FnOnce(&A) -> Result<u128, E>,
    mismatch: impl FnOnce() -> E,
) -> Result<A, E> {
    let adapter = create(requested_guid)?;
    if actual_guid(&adapter)? != requested_guid {
        return Err(mismatch());
    }
    Ok(adapter)
}

#[cfg(test)]
mod tests {
    use super::create_verified_adapter;
    use std::cell::{Cell, RefCell};

    #[test]
    fn creation_and_actual_identity_precede_session() {
        let calls = RefCell::new(Vec::new());
        let adapter = create_verified_adapter(
            7,
            |guid| {
                calls.borrow_mut().push("create");
                Ok::<_, &str>(guid)
            },
            |guid| {
                calls.borrow_mut().push("actual-guid");
                Ok(*guid)
            },
            || "mismatch",
        )
        .unwrap();
        calls.borrow_mut().push("session");
        assert_eq!(adapter, 7);
        assert_eq!(*calls.borrow(), ["create", "actual-guid", "session"]);
    }

    #[test]
    fn collision_or_create_race_never_falls_back_to_an_existing_alias() {
        let actual_calls = Cell::new(0);
        let foreign_adapter = 9;
        let result = create_verified_adapter(
            7,
            |_| Err::<u128, _>("alias-collision"),
            |_| {
                actual_calls.set(actual_calls.get() + 1);
                Ok(foreign_adapter)
            },
            || "mismatch",
        );
        assert_eq!(result, Err("alias-collision"));
        assert_eq!(actual_calls.get(), 0);
        assert_eq!(foreign_adapter, 9); // Never passed to the product creation function.
    }

    #[test]
    fn actual_identity_mismatch_cannot_start_a_session() {
        let sessions = Cell::new(0);
        let result =
            create_verified_adapter(7, |_| Ok::<_, &str>(9), |guid| Ok(*guid), || "mismatch")
                .map(|_| sessions.set(sessions.get() + 1));
        assert_eq!(result, Err("mismatch"));
        assert_eq!(sessions.get(), 0);
    }

    #[test]
    fn failed_identity_query_cannot_start_a_session() {
        let sessions = Cell::new(0);
        let result =
            create_verified_adapter(7, |_| Ok::<_, &str>(7), |_| Err("no-luid"), || "mismatch")
                .map(|_| sessions.set(sessions.get() + 1));
        assert_eq!(result, Err("no-luid"));
        assert_eq!(sessions.get(), 0);
    }

    #[test]
    fn failed_verification_drops_only_the_new_adapter_value() {
        struct Created<'a>(&'a Cell<u32>);
        impl Drop for Created<'_> {
            fn drop(&mut self) {
                self.0.set(self.0.get() + 1);
            }
        }
        let created_drops = Cell::new(0);
        let foreign_drops = Cell::new(0);
        let _foreign = Created(&foreign_drops);
        let result = create_verified_adapter(
            7,
            |_| Ok::<_, &str>(Created(&created_drops)),
            |_| Ok(9),
            || "mismatch",
        );
        assert!(matches!(result, Err("mismatch")));
        assert_eq!(created_drops.get(), 1);
        assert_eq!(foreign_drops.get(), 0);
    }
}
