# ADR-020 — The Cloudinary assets have no backup, and that is accepted until launch

**Status:** accepted, provisional · 2026-08-18 · closes the WO-55 half of DATA-06 · **needs the owner's confirmation**.

Registration documents — NID front and back, member photo, signature — live only
in Cloudinary. There is no export, no second copy, and the account is a free tier
with a quota. The database has an encrypted nightly `pg_dump` drilled on every
push (DATA-01 → 05); the images have nothing.

WO-55 asked for a decision "even if the answer is *accept the risk until
launch*". This is that answer, with the reasoning written down so it can be
revisited rather than forgotten:

- **There is nothing to lose yet.** The platform holds no real member documents;
  every asset in the account today came from a test.
- **The failure is bounded and recoverable while that is true.** A lost image is
  a member asked to photograph their NID again — not a lost balance, and not a
  record that cannot be reconstructed.
- **The cost of building it now is a script that cannot be tested**, because
  testing it means real credentials and real assets. An export job written
  against an empty account is a hypothesis, and this repository has already paid
  for one of those (see the Dockerfile trap).

**The trigger is the first real member document**, not a date. From that moment
the exposure is a regulatory record held in one place by one third party, and
the job has to exist before the account does anything unexpected.

**What it will need when it is built:** list `hasnahena/registrations/**` via the
Admin API, download to the same encrypted destination the `pg_dump` backup uses,
and — because the `documents` table holds the URLs — reconcile the two so a
missing asset is *detected* rather than discovered by an approver opening a
blank image.

---

[← all decisions](../decisions.md)
