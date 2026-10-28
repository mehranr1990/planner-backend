# 0017: ISO currency minor-unit authority amendment

Status: APPROVED by owner, 2026-10-29, for the bounded ADR 0016 amendment.

## Concrete conflict

ADR 0016 intends ISO-4217 money precision but proposes the pinned Node Intl currency
inventory as its source. Verification against SIX List One, published 2026-09-17,
shows that source is unsuitable for ISO precision: Intl reports zero decimals for
AFN, COP, IDR and IRR while the official inventory specifies two. It retains some
historical codes and omits valid four-decimal units such as CLF. Twenty-four entries
in the proposed Intl map differ or are absent from the current official inventory.
No Finance table or financial record has been created or posted yet.

Primary sources: [ISO currency codes](https://www.iso.org/iso-4217-currency-codes.html),
[SIX maintenance agency](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html),
[SIX List One XML](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml).

## Proposed narrow amendment

- Replace only ADR 0016's currency-code/minor-unit source with the official current
  SIX List One snapshot, published 2026-09-17 and retrieved 2026-10-29. Freeze the
  165 unique codes with an explicit numeric minor unit 0-4 in the contracts package.
  Reject codes whose minor unit is N.A., withdrawn codes, arbitrary codes and crypto.
  Include valid ISO four-decimal units; do not guess a precision from Intl.
- Store source URL, published/retrieval date and SHA-256 provenance with the frozen
  code/scale map. No network lookup at runtime, provider integration, dependency,
  fee, automatic refresh or currency conversion service. Intl remains appropriate
  for date/calendar/display calculations, not accounting minor-unit authority.
- Currency, decimal persistence, exact BigInt arithmetic, HALF_UP FX, ledger,
  correction, temporal, ownership and all other ADR 0016 policies remain unchanged.
  Snapshot changes require a future reviewed decision; existing account scale and
  historical postings must never be silently reinterpreted.
- Regenerate only the new, unsuccessful P1-09 migration's currency checks before
  successful deployment. That migration failed at its first statement with zero
  applied steps; verified schema/table sets and all pre-existing full-row hashes
  are unchanged. Resolve only that failed ledger record as rolled back; preserve
  all 15 previously applied migration files/checksums and data. No reset or table
  recreation, and no modification of any successfully applied migration.

## Verification

Test AFN/COP/IDR/IRR=2, JPY=0, KWD=3 and CLF/UYW=4; reject invalid and N.A. codes.
Verify contract/database scale agreement and source snapshot hash. Re-run targeted
money/schema/migration tests, then mandatory final gates, preservation checks and
compiled restart smoke. No broader architecture or scope change is requested.

Owner approval: Explicit approval of this proposal in the P1-09 session.
