# Architecture

Markit is a Tauri 2 desktop application. React and TypeScript implement the
interface in `apps/desktop/src`; Rust handles files and platform services in
`apps/desktop/src-tauri`. Typed commands and events connect the two layers.

## Documents and editing

Markdown is the stored document format. Each open document tracks its source,
saved source, file revision, selection, scroll position and editing mode.
CodeMirror 6 provides source editing and live preview decorations. The
ProseMirror schema in `packages/editor` provides a semantic document model and
source mapping utilities.

Rust preserves UTF-8 BOM and line endings, writes files atomically and checks
file revisions before saving. The frontend prompts when a file changes on
disk. Unsaved document snapshots are stored in the Tauri application
configuration directory and offered for recovery at the next launch.

## Desktop window

Tauri handles dragging and platform-specific double-click behavior for the
custom titlebar. Buttons are excluded from the drag region.

The close-request listener checks for unsaved documents. A clean window closes
immediately; an edited document opens a save, discard or cancel dialog. Tauri's
`onCloseRequested` helper finishes an accepted close with `destroy()`, so the
main window capability grants both `allow-close` and `allow-destroy`.

## Packages

| Path | Responsibility |
| --- | --- |
| `apps/desktop` | React interface, editors and desktop bridge |
| `apps/desktop/src-tauri` | File services, image handling and platform integration |
| `packages/contracts` | Document, revision and plugin data types |
| `packages/markdown` | Markdown rendering and heading extraction |
| `packages/editor` | Semantic document model and source operations |
| `packages/plugin-sdk` | Plugin packages, permissions and Worker host |
| `plugins/citations` | Zotero integration and citeproc formatting |
| `src` | Electron implementation and shared modules used by the citations plugin |

## Plugins

A `.markit-plugin` archive contains a manifest, a bundled entry module and an
optional integrity record. Settings provides installation, enable/disable and
removal controls. Manifests declare the plugin's permissions and contributions.

Plugin code runs in a Worker. Commands, document updates, settings and network
requests pass through the host API. The host renders declarative panel content
in the sidebar. Network requests support HTTP GET and POST to the local Zotero
API on port 23119, with request-size, response-size and timeout limits.

The Citations plugin stores search results through the settings API, formats
bibliographies with citeproc-js and sends citation-number mappings to the live
editor and HTML exporter. Citation keys remain in the Markdown source.

See the [plugin development guide](../resources/Extensions.md) and
[Citations documentation](../plugins/citations/README.md).

## Development and builds

See [Development](../resources/Development.md) for dependencies, commands and
release steps, and [Testing](../resources/Validation.md) for automated and
manual checks. Release artifacts are built by GitHub Actions on each target
operating system. Linux uses WebKitGTK 4.1 and GTK3.
