# NIS2 rule engine (backend copy)

`types.ts`, `constants.ts`, `sectors.ts`, `rules.ts` and `evaluate.ts` in this
directory are a **verbatim copy** of `src/lib/nis2/*` in the `iwill-bg-storefront`
repository. They are pure, dependency-free TypeScript so the same classification
can be reproduced on the server.

There is no shared package between the two repositories, so the copy is kept in
sync by hand. Two things make drift visible rather than silent:

1. `RULES_VERSION` in `constants.ts` must be bumped in both repositories
   together whenever the rules change.
2. `POST /store/nis2/assessments` recomputes the classification and compares it
   with the one the caller submitted. A mismatch is stored with
   `requires_manual_review = true` and logged, so a divergence shows up in the
   data instead of quietly producing wrong lead scoring.

When changing the rules: edit the storefront copy first, run its unit tests
(`npm test` in `iwill-bg-storefront`), then copy the files here.
