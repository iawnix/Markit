# Markit Architecture

Markit uses Tauri 2 as its desktop entrypoint. React and TypeScript live in
`apps/desktop`, while Rust owns privileged and platform-specific operations.
The previous Electron entrypoint remains in the repository only as a migration
reference; new desktop features target Tauri.

## Runtime boundary

React owns document state, editor state, layout and accessible controls. Rust
owns local files, atomic saves, revision checks, image validation, workspace
search and platform integration. The UI communicates with Rust only through
typed Tauri commands and events. It never receives Node APIs or arbitrary file
URLs.

The durable document format is Markdown. CodeMirror edits the source directly;
the ProseMirror schema in `packages/editor` is a semantic projection. Unknown
blocks remain in the source editor until a lossless projection is available.

## Package boundaries

- `packages/contracts`: serializable document, revision and plugin contracts.
- `packages/markdown`: heading extraction and rendering primitives.
- `packages/editor`: ProseMirror projection and source range operations.
- `packages/plugin-sdk`: manifest, permission and host API types.
- `plugins/citations`: planned optional Zotero/CSL integration.

## Local development

Install Node 24, Rust stable and the platform Tauri prerequisites. From the
repository root:

```sh
npm ci
npm run tauri:dev
```

The browser-only frontend can be checked without Rust:

```sh
npx tsc -p apps/desktop/tsconfig.json --noEmit
npm run tauri:frontend
```

Linux builds use WebKitGTK 4.1 and are produced in the Ubuntu 24.04 CI image.
AppImage packages therefore require the host WebKitGTK/GTK runtime; DEB and RPM
packages declare those dependencies. Fedora and Manjaro builds use the same
Linux artifact and their distribution WebKitGTK compatibility packages.

## Plugin boundary

Plugins are `.markit-plugin` packages with a manifest, an entry module and an
integrity record. Plugin code runs in a Worker and requests filesystem,
network, command and settings access through a capability broker. UI
contributions are declarative so plugins do not depend on React internals.
