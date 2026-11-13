# Resource collections

Resource collections share a deliberate selection of source resources without copying their upstream contents. A collection records each catalog's HTTPS GitHub repository, its configured name/mapping, the full upstream commit SHA, and the selected resources' kind, ID, repository-relative path, and descriptive metadata. The commit pin and path provide reproducible provenance; they are not a content archive.

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


## Scope and limitations

A collection is not a lockfile or offline distribution. Import does not embed upstream content or guarantee that a commit remains reachable. Installing a selected resource still requires retrieving the pinned commit from GitHub (and applicable Git tooling/network access); a later catalog refresh can advance catalog indexes. A valid, approved signature authenticates the signer and manifest integrity only; it is not a safety assessment or independent proof of upstream provenance.

Collections are separate from `kitia catalog export/import`: those commands share the catalog registry itself, while collections share selected, pinned resource references.
