# Workspace class type-ahead / IntelliSense TODO

## Goal

Give the XPscript VS Code extension type-ahead, hover and signature help for classes declared in the current workspace, including generated OpenAPI client/model classes, without requiring those classes to be added to the static runtime API catalog.

## Core design

The compiler remains the authority for XPscript name and scope semantics. The extension should mirror the compiler's observable scope rules rather than introduce a second broad reserved-name model.

Keep the existing static runtime API catalog for built-in XPscript APIs. Add a workspace symbol index for user/generated XPscript declarations, then resolve the current document/local scope on top of those sources.

Resolution layers:

1. Built-in/runtime API catalog.
2. Workspace symbols from all relevant `.xps` files.
3. Current-file and local scope/type information.

Names are case-insensitive where XPscript is case-insensitive. Receiver/member lookup and unqualified/global lookup are distinct. A member such as `item.JsonParse` must remain a member lookup even though `JsonParse(...)` can be a runtime/global function.

## Workspace symbol index

- [ ] Discover relevant `.xps` files in the active workspace.
- [ ] Parse/index public class declarations.
- [ ] Index class properties/fields with declared XPscript types.
- [ ] Index class functions/subs, parameters and return types.
- [ ] Index enums and other declaration kinds needed for type resolution.
- [ ] Keep source URI and ranges for every indexed declaration.
- [ ] Use case-insensitive symbol keys while preserving declared spelling for display.
- [ ] Do not require generated files to carry special OpenAPI metadata.
- [ ] Exclude compiler/build output that should not participate in source resolution.
- [ ] Support multiple workspace folders.

## Incremental updates

- [ ] Build the initial workspace index without blocking editor startup.
- [ ] Re-index a document on open/change/save as appropriate.
- [ ] Remove symbols when a source file is deleted or renamed.
- [ ] Invalidate only affected symbol/type caches where possible.
- [ ] Ensure OpenAPI regeneration updates completion without restarting VS Code.
- [ ] Bound scanning/caching for large repositories.

## Type resolution

- [ ] Extend current `Dim x As Type` inference to workspace-defined types.
- [ ] Support `Dim x As New Type`.
- [ ] Resolve function return types from workspace functions/methods.
- [ ] Resolve chained member expressions from workspace types.
- [ ] Resolve properties returning another workspace type.
- [ ] Preserve receiver scope for `object.Member`.
- [ ] Preserve unqualified/global resolution separately.
- [ ] Handle same member spelling in unrelated classes independently.
- [ ] Handle case-insensitive collisions consistently with compiler behavior.
- [ ] Avoid global pseudo-reservation of runtime function names.

## Completion

- [ ] Offer members after `variable.` when the variable type is workspace-defined.
- [ ] Offer methods, properties and relevant fields with the correct VS Code completion kind.
- [ ] Show declared XPscript signatures.
- [ ] Insert method-call snippets with parameters.
- [ ] Include OpenAPI-generated API operations automatically.
- [ ] Include OpenAPI-generated model members automatically.
- [ ] Preserve names such as `JsonParse`, `StrLeftBack` and `SHA256` when they are valid members.
- [ ] Merge runtime and workspace completion only according to actual resolution scope; do not blindly concatenate catalogs.

## Hover and signature help

- [ ] Hover workspace classes and members.
- [ ] Show source-declared type/signature.
- [ ] Show method parameter and return-type information.
- [ ] Provide signature help for workspace methods.
- [ ] Make generated OpenAPI methods behave exactly like handwritten class methods.

## Navigation follow-up

Not required for the first type-ahead milestone, but design the symbol index so it can later support:

- [ ] Go to Definition.
- [ ] Find References.
- [ ] Document/workspace symbols.
- [ ] Rename with scope-aware collision checks.

## OpenAPI integration contract

The OpenAPI generator should not emit a second IntelliSense catalog. Generated `.xps` is normal XPscript source and must be indexable exactly like handwritten source.

Example:

```xpscript
Dim api As New PetStoreApi("https://example.test")
api.
```

Type-ahead should expose generated operations and public API members.

Likewise:

```xpscript
Dim pet As Pet
pet.
```

should expose the generated model members using their actual XPscript declaration names.

Regenerating the OpenAPI source must refresh the workspace index automatically.

## Tests

- [ ] Handwritten class property completion.
- [ ] Handwritten method completion and signature help.
- [ ] Cross-file class completion.
- [ ] Cross-file return-type chaining.
- [ ] Two classes with the same member name.
- [ ] Case-insensitive member lookup.
- [ ] Member named `JsonParse`.
- [ ] Member named `StrLeftBack`.
- [ ] Runtime/global `JsonParse(...)` remains distinct from `object.JsonParse`.
- [ ] OpenAPI-generated client operation completion.
- [ ] OpenAPI-generated model property completion.
- [ ] OpenAPI regeneration refreshes completion.
- [ ] File rename/delete invalidates stale symbols.
- [ ] Large-workspace indexing/cache regression.
- [ ] Existing runtime IntelliSense remains unchanged.

## Implementation order

1. Extract a reusable workspace XPscript declaration parser/index.
2. Add incremental workspace indexing and cache invalidation.
3. Feed workspace-defined types into the existing variable/type resolver.
4. Add member completion from workspace symbols.
5. Add hover and signature help.
6. Add OpenAPI-generated-source regression fixtures.
7. Harden scope/case/collision behavior against compiler rules.
8. Add performance tests and large-workspace safeguards.
9. Consider navigation features using the same symbol index.

## Completion gate

The work is complete when a generated or handwritten XPscript class can be included in an application and VS Code provides type-ahead for its public members without static catalog changes, OpenAPI-specific IntelliSense metadata, or editor restart after regeneration, while existing built-in IntelliSense continues to work.
