# Citations and Zotero

The Citations plugin connects Markit to a local Zotero library. It provides a
References sidebar, citation insertion and numeric bibliographies formatted
with citeproc-js.

## Install

1. Download `Markit-citations-<version>.markit-plugin` from
   [Releases](https://github.com/iawnix/markit/releases/latest).
2. Open Markit settings and choose **安装插件 / Install plugin**.
3. Select the package, review its requested permissions and enable it.
4. Start Zotero and enable its local API in Zotero's advanced settings.

The plugin uses the Zotero HTTP API at `http://127.0.0.1:23119/api/`.

## Use

Open a Markdown document, then select **References** in the sidebar. Search by
title, author or year and press Enter. Selecting a result appends its citation
to the document as `[@XXXXXXXX]`, using the eight-character Zotero item key.

Plugin commands appear in the application menu:

| Command | Action |
| --- | --- |
| Check Zotero connection | Request an item from the local API |
| Insert Zotero citation | Append a citation for the first returned item |
| Insert bibliography marker | Add `<!-- markedown:bibliography -->` to the document |
| Refresh bibliography | Resolve cited items and write a numeric bibliography |

Move the bibliography marker to choose where the list appears. Citation
numbers are displayed in live preview and HTML export; the Markdown stores the
Zotero keys. Search results are cached for five minutes.

## Build

From the repository root:

```sh
npm ci
npm run plugin:citations
```

The output is `plugins/citations/dist/markit.citations.markit-plugin`. See the
[plugin development guide](../../resources/Extensions.md) for the host API.

## Permissions and attribution

The manifest requests document read/write, network, commands and settings
access. The host routes GET and POST requests to Zotero on port 23119.

Bibliography formatting uses citeproc-js by Frank Bennett, distributed under
the CPAL 1.0 option. The References panel displays its attribution. License
texts and source information are listed in
[Third-party notices](../../resources/ThirdPartyNotices.md#citeproc-js).
