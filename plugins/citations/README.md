# Markit Citations Plugin

This optional plugin owns Zotero connectivity, CSL metadata, citeproc
formatting and bibliography UI. The Markit core does not load it or include
its dependencies at startup.

The package keeps the existing `<!-- markedown:bibliography -->` marker for
backward compatibility. It must declare loopback network access and access to
its own cache directory before activation.

The host exposes Zotero requests through the plugin Worker network broker. The
broker only permits HTTP GET and POST requests to `localhost:23119` and applies
fixed request, timeout and response-size limits.

The package provides a References panel, Zotero connection check, citation
insertion from the first available local item, bibliography marker insertion,
and bibliography refresh for citation keys in the current Markdown document.
Bibliography ordering and formatting use the bundled citeproc-js engine. Search
results are cached per query for five minutes through the host settings API,
and resolved citation keys are sent to the host so the live editor can display
numbered inline citations without changing the Markdown source. The panel
displays the required Frank Bennett attribution.

Remaining limitations are deliberate: the plugin currently queries Zotero's
local HTTP API, supports numeric citations only, and does not provide an
online bibliography service or a plugin marketplace.
