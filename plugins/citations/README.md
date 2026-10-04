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

The first package provides a References panel, a command for inserting the
backward-compatible bibliography marker, and a Zotero connection check. CSL
rendering, cached reference search and bibliography replacement are being
migrated into this package next.
