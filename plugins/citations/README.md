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
Bibliography ordering and formatting use the bundled citeproc-js engine and
the panel displays its required Frank Bennett attribution. Cached reference
search is the next migration step.
