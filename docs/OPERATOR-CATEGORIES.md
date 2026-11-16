# Operator-created categories

`scripts/create-group-category.ts` creates one category template in one group when a group manager asks for it to be set up for them. It runs the same validation, lock and case-insensitive uniqueness rule as the app's `createCategory`. The audit row has a **null actor**, with `operator: true` and a note saying who requested it, because an operator must not appear as the group's manager.

```sh
CATEGORY_DATABASE_URL=postgresql://... npx tsx scripts/create-group-category.ts --spec=category.json            # validate, roll back
CATEGORY_DATABASE_URL=postgresql://... npx tsx scripts/create-group-category.ts --spec=category.json --apply    # create
```

The spec is `{groupId, name, fields, note}`; `fields` defaults to none, like the app, and uses the app's template schema (`text | number | price | select | boolean | location`, at most one location field). The script never overwrites an existing category. The same name with an identical template is a no-op (`already-exists`); a different template is an error. A non-loopback database needs `--allow-remote`. **A production run needs the group owner's or Patrick's explicit request.**

Restaurant template, as used for Onlyfans Subscribers (TKT-20102):

```json
[{"id":"location","label":"Location","type":"location","required":true,"filterable":false},
 {"id":"cuisine","label":"Cuisine","type":"text","required":false,"filterable":true},
 {"id":"price","label":"Price","type":"price","required":false,"filterable":true}]
```

A location field turns on place search when rating and the List/Map toggle inside the category. Tests: `tests/integration-operator-tools.test.ts`.
