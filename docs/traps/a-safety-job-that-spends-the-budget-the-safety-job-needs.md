# A safety job that spends the budget the safety job needs

- **The restore drill ran on every code commit and the nightly backup stopped for
  four days.** GitHub Free gives 2,000 Actions minutes and a $0 spending limit,
  so running out stops Actions rather than billing. August 2026: 2,033 minutes,
  85.8% `ci.yml`, and no workflow at all from the 28th to the 31st.
- **A scheduled job that never starts cannot fail.** No red run, no email — just
  a gap in the Actions tab that looks like a quiet week. The first evidence was a
  billing CSV.
- **A guard that shares a metered resource with the thing it guards can starve
  it.** Gate a safety job on the inputs it proves (`ci.yml` runs the drill only
  when `scripts/`, the schema or migrations change), check usage monthly, and if
  minutes run out, first verify last night's backup ran.

---

[← all traps](../traps.md)
