# Connection pools and transactions

- **Reading config from the pool inside a transaction deadlocks it.** With N
  goroutines and a pool of N, every connection is held by an open transaction and
  every transaction waits for a free connection to read a config key. Nothing
  errors and nothing times out — the suite hangs until the framework kills it.
  Use the `…Tx` readers inside a transaction ([ADR-017](../decisions.md)).
- **`&&` short-circuiting can hide a latent deadlock for weeks.** The same shape
  already existed behind `activeLoan > 0 &&`, false in the common case. The test
  that eventually exposed it had been green the whole time, over code one boolean
  away from hanging.

---

[← all traps](../traps.md)
