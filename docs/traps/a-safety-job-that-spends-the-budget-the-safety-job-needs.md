# A safety job that spends the budget the safety job needs

**The restore drill ran on every code commit and the nightly backup stopped for
four days.** GitHub Free gives a private repository 2,000 Actions minutes a
month and a **\$0 default spending limit** — so exhausting them is never a bill,
it is Actions *stopping*. The August 2026 usage export shows 2,033 minutes
across seventeen days, **85.8% of it `ci.yml`**, `backup.yml` and `monitor.yml`
vanishing after the 27th, and no workflow running at all from the 28th to the
31st.

Nothing reported it. **A scheduled job that never starts cannot fail**, so there
is no red run, no failure email and no alert — the Actions tab simply has a gap
in it, which looks exactly like a quiet week. The database and asset backups
were absent for the last four days of the month and the first evidence was a
billing CSV read for an unrelated reason.

The part worth carrying: the drill exists to prove the nightly backup can be
restored, and it was consuming the minutes that the nightly backup itself needed.
**A guard that shares a metered resource with the thing it guards can starve
it**, and the failure is silent on both sides. Gate a safety job on the inputs it
actually proves — `scripts/`, the schema and the migrations for this one — not on
"any code changed", and check the usage page monthly. If minutes run out, the
first thing to verify is that last night's backup ran.

---

[← all traps](../traps.md)
