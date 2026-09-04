# Documentation

The [root README](../README.md) covers what Kintsugi is and how to run it.
Everything below is the detail deliberately kept out of it.

## Start here

**New to the codebase?** Read [architecture/README.md](architecture/README.md) —
one diagram and the five ideas that explain most of the code — then skim the
[decision records](adr/README.md).

**Adding a feature?** [architecture/lld.md](architecture/lld.md) for module
boundaries and conventions, [architecture/data-model.md](architecture/data-model.md)
for the schema and its invariants.

**Integrating against the API?** [api.md](api.md).

**Wondering why something is built a certain way?** [adr/](adr/README.md). If the
answer isn't there and the decision wasn't obvious, that's a gap worth filling.

**Looking at work not yet done?** [plans/](plans/). Everything else here
describes code that exists; those describe code that does not, and say so at the
top. A plan is deleted once its last phase lands.

## Contents

```
docs/
├── architecture/
│   ├── README.md        Overview and orientation
│   ├── hld.md           Context, containers, request lifecycle, security model
│   ├── lld.md           Modules, flows, sequence diagrams, conventions
│   └── data-model.md    ER diagram, tables, invariants, migrations
├── api.md               Endpoint reference
├── adr/                 Numbered decision records
└── plans/               Work not yet built. Deleted as it lands.
```

## Keeping this honest

Documentation that describes intentions rather than the code is worse than none,
because it is believed. Two habits keep it usable:

- **State what is not built.** Every document marks stubs and gaps explicitly.
  The three deliberate stubs — email, file storage, identity verification — are
  listed in [hld.md §6](architecture/hld.md#6-deliberate-stubs), and known
  limitations in [§7](architecture/hld.md#7-known-limitations).
- **Update docs in the same change as the code.** A schema change touches
  `data-model.md`; a new endpoint touches `api.md`; a non-obvious choice gets an
  ADR. See [CONTRIBUTING.md](../CONTRIBUTING.md).

Diagrams are [Mermaid](https://mermaid.js.org) in fenced blocks, which GitHub
renders natively — so they are diffable text, not binary images that drift out
of date.
