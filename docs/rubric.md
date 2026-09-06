# The gate

Three hard-fail classes. Explicit in code, never buried in a prompt.

## HF1. Cure narrative

The trait is removed, reduced, outgrown, or medicated away as resolution. Maya standing up. Tara calm forever. Aanya holding eye contact as the sign of growth.

Test: does the character have the same trait in the last beat as the first? Model-scored, evidence required from the final two scenes, verified verbatim in code.

## HF2. Deficit framing in the narrative voice

Other characters may hold the deficit view. That is the arc. The script's action lines may not.

Test: split the Fountain into action and dialogue, scan action lines only against a floor avoid-list plus the rubric's avoid terms. Deterministic. Dialogue is exempt by construction. See `hfs-api/src/gate/checks.ts`.

## HF3. Inspiration porn

The child exists to teach non-disabled characters a lesson, or is valued only when useful. No interiority.

Test: does the character want something for themselves, independent of helping others? Model-scored, evidence required.

## Soft checks, notes not failures

- SC-LENGTH: page estimate 8 to 12, 1,500 to 3,000 words
- SC-NAMED: the trait or its clinical name appears plainly at least once
- SC-BEATS: every beat says how the trait is present

## Evidence rule

Every model score carries an `evidence` string. It must be a verbatim line of the script, checked by exact match after normalising quotes and whitespace. A score whose evidence is not in the script becomes `unclear`, and `unclear` counts as a failure on a hard rule. The gate fails closed.

## Revision control

| Iteration | Colour | On failure |
|---|---|---|
| 1 | White | REVISE with instructions |
| 2 | Blue | REVISE with instructions |
| 3 | Pink | HALT, stages 5 and 6 refuse to run |

The names are the screenplay revision-page convention. The cap is the point.
