# Resource collections

Resource collections share a deliberate selection of source resources without copying their upstream contents. A collection records each catalog's HTTPS GitHub repository, its configured name/mapping, the full upstream commit SHA, and the selected resources' kind, ID, repository-relative path, and descriptive metadata. The commit pin and path provide reproducible provenance; they are not a content archive or an installation bundle.

## Export a selection

Configure and refresh the relevant user catalog first, then select resources explicitly:

```sh
kitia collection export team-tools.json team-tools:skill:review-pr team-tools:agent:release-helper
kitia collection export signed-team-tools.json team-tools:skill:review-pr --signing-key ./team-private.pem
```

Selectors use `catalog:kind:id`. Export fails if a resource is unavailable or lacks a full commit pin. The resulting version-1 JSON collection contains no resource source text. Signing is optional; `--signing-key` reads an Ed25519 private PEM file and signs the canonical manifest before writing it.

## Import a collection

```sh
kitia collection import team-tools.json
kitia collection import signed-team-tools.json --trusted-key ./approved-public.pem
```

Import validates the complete manifest, repository URLs, catalog definitions, pinned commits, resource identities and paths, and conflicts with configured catalogs before changing the user's catalog configuration. It registers the referenced catalogs and writes minimal pinned catalog indexes containing the selected references. All new indexes and both registries are staged before publication; if a publication rename fails, Kitia rolls the files back and preserves the prior registries. It does not refresh the catalogs or install resources. Existing catalog name/repository conflicts reject the whole import rather than silently remapping provenance.

`--trusted-key` reads a PEM public-key file supplied and approved out of band; a public key embedded in a manifest is never treated as trusted. The signature carries a `key_id` fingerprint (`sha256:` plus the SHA-256 hash of the public key's DER/SPKI encoding). Signed imports require this approved key and fail closed if it is missing, mismatched, or the manifest was altered. Passing `--trusted-key` also requires a signature; unsigned manifests remain importable without that option for compatibility.

Version-1 signatures use Ed25519 over recursively key-sorted canonical JSON with a versioned Kitia domain separator. This proves that the approved key signed those manifest bytes; it does not establish that the resources are safe or independently prove that the claimed repository/commit supplied them.

## Signed content bundles

Use a bundle when selected resources must be installable without contacting their upstream repository after export:

```sh
kitia bundle export team-tools.bundle.json team-tools:skill:review-pr team-tools:agent:release-helper team-tools:instruction:security --signing-key ./team-private.pem
kitia bundle import team-tools.bundle.json --trusted-key ./approved-public.pem
kitia install skill review-pr --offline --audit
kitia install agent release-helper --tool both --offline --audit
kitia install instruction security --offline --audit
```
To publish a later pinned version of the same catalog, export a new bundle and explicitly replace the matching catalog:

```sh
kitia bundle export team-tools-v2.bundle.json team-tools:skill:review-pr --signing-key ./team-private.pem
kitia bundle import team-tools-v2.bundle.json --trusted-key ./approved-public.pem --replace
kitia update --offline
```

Without `--replace`, an import still rejects any configured catalog name or repository conflict. With it, each existing catalog is replaceable only when its name, GitHub repository identity, and Basic/Custom mode and path mappings exactly match the configured definition. Name/repository conflicts or changed mappings fail closed. A replacement atomically publishes the new pinned index, bundle cache and registry state while preserving unrelated catalogs; subsequent offline updates use the new pin and bytes.

Bundle export reads each selected resource's exact Git blobs at its full pinned commit, including skill support files, and signs the version-1 manifest containing those bytes as base64 with a SHA-256 fingerprint and executable bit for every file. The signature is mandatory. Import requires the signer's public PEM to be supplied and approved out of band; the manifest never establishes trust in its own key. The displayed `sha256:` fingerprint identifies the public key and should be compared through a trusted channel before approval. Import verifies the signature and every file digest before atomically publishing catalog indexes, configuration, the signed bundle cache, and the approved key.

Imported bundles use the normal Kitia install lifecycle and managed inventory for skills, agents, and instructions. Bundle skills are written by Kitia into the usual skill locations rather than delegated to `gh skill`; normal `--tool`, `--scope` where supported, audit, conflict protections, update, and uninstall behavior apply. `--audit` analyzes the verified cached bytes used for installation, including skill support files; findings or incomplete coverage block writes. Bundled resources remain pinned to their original catalog commit. Offline installation and updates require a complete, intact imported cache; Kitia fails rather than falling back to network or reporting an install that did not happen.

The signature authenticates the signer and bundle integrity, not resource safety or independently proven upstream authorship. At export, Kitia obtains Git objects from the configured repository and checks out the exact commit; this is not a third-party attestation that the signer retrieved honest upstream content. Git is needed for export, but a later offline install needs neither Git nor `gh`. Bundles reject symbolic links, submodules, Git LFS pointer files (external LFS objects are not embedded), case/Unicode-normalization path aliases, and Windows-reserved or trailing-dot/space path components. Paths are rejected, never renamed, before output or configuration publication. Version 1 limits the manifest to 128 MiB, decoded file content to 64 MiB total, 16 MiB per file, and 4096 files. Bundles contain only explicitly selected resources, not their dependencies or arbitrary repository state.

## Scope and limitations

A collection is not a lockfile for transitive dependencies or an offline distribution. Import does not embed upstream content or guarantee that a commit remains reachable. Installing a selected resource still requires retrieving the pinned commit from GitHub (and applicable Git tooling/network access); a later catalog refresh can advance catalog indexes. A valid, approved signature authenticates the signer and manifest integrity only; it is not a safety assessment or independent proof of upstream provenance.

Collections are separate from `kitia catalog export/import`: those commands share the catalog registry itself, while collections share selected, pinned resource references.
