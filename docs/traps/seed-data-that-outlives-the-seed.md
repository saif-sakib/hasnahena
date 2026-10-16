# Seed data that outlives the seed

- **"Reusing the row" is not the same as resetting the account.** The cutover
  purge set the role, the status and the password on the two launch admins and
  left every other column as it found it — so both went into production carrying
  an old seed's invented values: `HN-A-001` and `STF-MOB97EFH` (two dead
  numbering schemes), a birthday of 1985-05-20, parents called `Admin Father` and
  `Admin Mother`, and **an NID of `9876543210987`**. That last one is the
  dangerous one: `users_nid_live_key` is a *unique* index over live rows, so a
  fabricated national ID sitting on an admin account is a real member refused at
  registration one day with "that NID is already in use" — a refusal no screen
  can explain and no admin can clear. **The general form: a seed writes
  plausible values into required columns, and plausible is exactly what nobody
  re-reads.** Enumerate the fields a reset must clear, and have the script print
  what it changed field by field rather than "row reused".
- **What a reset must *not* touch is as worth stating as what it must.** The row
  id, the email and the phone are identity other rows reference and the two
  things a person signs in with; the display name is something only the person
  can tell you, and inventing one is how `Admin` became somebody's name on every
  generated document. `test/unit/purge-script.test.ts` asserts the absence of
  those three from the update.

---

[← all traps](../traps.md)
