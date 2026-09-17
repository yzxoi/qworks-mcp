# Code provenance

This is an unofficial interoperability adapter.

`vendor/inspire-sdk.cjs` is a dependency closure derived from the SDK embedded in QWorks. The pinned build, SDK version, source digest and output digest are recorded in `vendor/manifest.json`. The file includes upstream SDK code and bundled third-party dependencies; ownership remains with their respective authors. This repository does not claim authorship of that code or grant a new license to it.

The adapter, command-line entry point, extractor, documentation and tests are maintained separately from that generated file. The package is marked `private` and `UNLICENSED`; no public redistribution license is provided by this project.

Upstream product: [QWorks](https://qworks.tech/solutions/sii).

Direct npm dependencies retain their respective licenses and notices in their installed packages. The source bundle used for this extraction did not contain a bundled license notice block; this file records provenance rather than inventing upstream license terms.

The independently implemented Jupyter connector uses the official `@jupyterlab/services` client (BSD-3-Clause) and `ws` (MIT), installed as npm dependencies. It does not include QWorks desktop UI or conversation-session code.
