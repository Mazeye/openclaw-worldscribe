## Observed problem

Separate runtime evidence from inference; link a deduplicated issue if available.

## Change and compatibility

Explain storage/schema changes, existing deployment behavior and rollback.

## Verification

- [ ] Synthetic regression fails before the fix and passes after it
- [ ] `npm run check`
- [ ] `npm run e2e:local`
- [ ] Packaged installation verified if packaging changed
- [ ] No memory content, credentials, private identities or machine paths in diff/body

## Boundaries

No automatic merge, publication, destructive migration or live reconfiguration.
State unverified behavior explicitly.
