# Markit Citations Plugin

This optional plugin owns Zotero connectivity, CSL metadata, citeproc
formatting and bibliography UI. The Markit core does not load it or include
its dependencies at startup.

The package keeps the existing `<!-- markedown:bibliography -->` marker for
backward compatibility. It must declare loopback network access and access to
its own cache directory before activation.
