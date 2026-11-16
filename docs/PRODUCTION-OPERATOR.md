# Production operator changes

Production PostgreSQL has TLS **off**, so its public TCP proxy is never used for operator work. `scripts/production-operator.py` runs one reviewed change through the encrypted SSH tunnel from `promote-database.py` (the same one `promote-resumable.py` reuses): `127.0.0.1` → SSH → the canonical `pg` container. It runs on Patrick's Mac only, where the private files live:

- `.private/railway-legacy.json`: canonical snapshot; its project, environment, service and volume IDs and port are checked before use. Pass `--credentials=<file>` (0600) when it lives in another checkout.
- A dedicated SSH identity (0600) whose public key is registered with Railway (`railway ssh keys`), and `ssh.railway.com`'s host key already in `known_hosts`. Remove a temporary key registration afterwards.

The password goes into a temporary 0600 pgpass file that is deleted when the run ends; it never appears in arguments, URLs or output. Logs go to a private `.private/operator-*` folder.

```sh
# Category (OPERATOR-CATEGORIES.md): runs as the app's runtime role (SET ROLE everrate_app)
python3 scripts/production-operator.py --identity-file .private/ssh/<key> category --spec=<spec.json>            # validate, roll back
python3 scripts/production-operator.py --identity-file .private/ssh/<key> category --spec=<spec.json> --apply    # create

# Same-product merges (SAME-PRODUCT-MERGES.md): plans from a fresh read-only snapshot, then the guarded applicator
python3 scripts/production-operator.py --identity-file .private/ssh/<key> plan-merges --review=<review.json> --evidence="<who approved what, when>"
python3 scripts/production-operator.py --identity-file .private/ssh/<key> apply-plan --plan=<plan.json>          # validate, roll back
python3 scripts/production-operator.py --identity-file .private/ssh/<key> apply-plan --plan=<plan.json> --apply  # apply
```

Only these three entry points run. Input files must be regular 0600 files under 2 MiB. The applicator runs as the operator role because it reads its own audit receipts, which the runtime role cannot; a rerun of an applied plan is a no-op. If the tunnel ends during a run, inspect the state read-only before retrying. **Every production `--apply` needs Patrick's explicit approval in the thread that runs it.**

Tests: `python3 -m unittest tests/production_operator_test.py` and `tests/integration-operator-tools.test.ts` (runtime-role category creation, private-file and tunnel-environment guards).
