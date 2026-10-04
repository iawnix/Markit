# Markit Architecture

Markit uses Tauri 2 as its only desktop entrypoint. React and TypeScript live in
`apps/desktop`, while Rust owns privileged and platform-specific operations.
The repository is maintained as an independent project; new desktop features
target Tauri and do not add a second desktop runtime.

## Runtime boundary

React owns document state, editor state, layout and accessible controls. Rust
owns local files, atomic saves, revision checks, image validation, workspace
search and platform integration. The UI communicates with Rust only through
typed Tauri commands and events. It never receives Node APIs or arbitrary file
URLs.

The durable document format is Markdown. The source editor edits the source
directly; the ProseMirror schema in `packages/editor` is a semantic projection.
Unknown blocks remain in the source editor until a lossless projection is
available. Rust preserves UTF-8 BOM, line endings and file revisions, performs
atomic saves, and rejects a save when the file changed outside Markit. Unsaved
documents are serialized to the Tauri application configuration directory with
a size limit. On the next launch the host asks whether to restore them; the
recovery file is removed after dismissal or once all documents are saved.

## Package boundaries

- `packages/contracts`: serializable document, revision and plugin contracts.
- `packages/markdown`: heading extraction and rendering primitives.
- `packages/editor`: ProseMirror projection and source range operations.
- `packages/plugin-sdk`: manifest, permission and host API types.
- `plugins/citations`: optional Zotero/CSL integration, packaged separately
  from the core application.

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
optional integrity record. The desktop settings manager validates the archive,
persists its manifest and enabled state, and displays requested permissions.
Plugin code runs in a Worker and requests filesystem, network, command and
settings access through a capability broker. UI contributions are declarative
so plugins do not depend on React internals. There is no online marketplace in
the first release; packages are installed locally. Registered commands are
shown in the editor toolbar and execute inside the plugin Worker. Registered
panels appear as isolated sidebar entries and receive no direct DOM access.
Network access is brokered by the host and currently limited to the local
Zotero endpoint at `localhost:23119`, with request, timeout and response-size
limits. The citations plugin uses this boundary for Zotero search and cache
updates, and exposes citation-number mappings to the live editor and HTML
exporter without moving citation metadata into Markdown storage.
