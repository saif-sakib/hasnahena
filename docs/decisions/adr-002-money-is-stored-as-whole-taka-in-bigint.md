# ADR-002 — Money is stored as whole taka in `BigInt`

**Status:** accepted · migrated in commits `8a402f0` and `93191ff`.

Balances were originally minor units (paisa) with ×100 conversions scattered across the frontend, backend, and PDF generation. Bangladeshi cooperative practice does not transact in paisa, and the conversions were a recurring source of 100× display bugs.

All amounts are now whole taka in `BigInt` columns. Never reintroduce a ×100 or ÷100, never use `float` for money, never store paisa.

---

[← all decisions](../decisions.md)
