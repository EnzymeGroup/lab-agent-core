# Installation

Requires Node.js 22.19+ and npm. The Python example requires Python 3.10+.
The executables `lab-agent` and `create-lab-agent` belong to the single package
`lab-agent-core`.

## Current: install a local build

The package is not published to npm yet. From a repository checkout:

```sh
npm ci
npm pack
node dist/create.js ../my-agent
cd ../my-agent
npm install ../lab-agent-core/lab-agent-core-0.1.0.tgz
```

The relative package path assumes the checkout is named `lab-agent-core` and
`my-agent` is beside it. For other locations, use the actual tarball path.
The generated project is independent; it depends on the package instead of
copying Core source. Commit its `package.json` and lockfile.

## Current: use a supplied tarball

Replace `/path/to/` with the actual package location:

```sh
npm exec --package=/path/to/lab-agent-core-0.1.0.tgz -- create-lab-agent my-agent
cd my-agent
npm install /path/to/lab-agent-core-0.1.0.tgz
```

Do not run plain `npm install` in a newly generated project before installing the
local tarball: its initial dependency names the unpublished registry version.

## Future: install from a registry

Use this only after the package has been published to your configured registry:

```sh
npm exec --package=lab-agent-core@0.1.0 -- create-lab-agent my-agent
cd my-agent
npm install
```

`npx create-lab-agent` refers to a different package name and is not the installer
for this project. Review the new project, then run `npx lab-agent trust` in it. Trust uses Pi's
native store and is required before project config/extension execution.
Configure a provider before inference; continue with the
[Quickstart](QUICKSTART.md).
