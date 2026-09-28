#!/usr/bin/env python3
"""Merge the eight FIPS 140-3 Phase 1 sub-inventory YAML files under
fips/inventory/ into a single consolidated cryptographic inventory artifact.

WO-019 (capstone of FIPS Phase 1 — Cryptographic Inventory and Discovery):
aggregates the outputs of WO-005 through WO-011 into fips/crypto_inventory.yaml
so that Phase 2/3/4 tooling has one machine-readable evidence artifact instead
of seven independently-shaped inventory files.

This script is a read-only aggregator: it does not modify any file under
fips/inventory/, and every row it emits is a copy (plus provenance tags) of a
real entry already present in one of those eight files — no entries are
fabricated or invented here.

Usage:
    python3 fips/scripts/merge_inventory.py [--check]

--check performs the full merge and prints the computed summary/quality-gate
status without writing fips/crypto_inventory.yaml (useful for CI dry runs).
"""
import argparse
import datetime
import pathlib
import subprocess
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
INVENTORY_DIR = REPO_ROOT / "fips" / "inventory"
OUTPUT_PATH = REPO_ROOT / "fips" / "crypto_inventory.yaml"

INVENTORY_SCHEMA_VERSION = "1.0.0"

MODULE_BOUNDARIES = [
    "barrier-internal",
    "seal-external-kms",
    "seal-shamir",
    "core-orchestration",
]

# Every sub-inventory file this WO's acceptance criteria requires, and the
# work order that produced it. Used both to drive the merge and to populate
# metadata.source_inventories (checked by validate_consolidated_inventory.sh).
SOURCE_WORK_ORDERS = {
    "keysutil_policy_crypto_sites.yaml": "WO-005",
    "core_barrier_seal_crypto_sites.yaml": "WO-006",
    "builtin_logical_crypto_sites.yaml": "WO-007",
    "builtin_credential_crypto_sites.yaml": "WO-007",
    "tls_listener_config.yaml": "WO-008",
    "crypto_dependencies.yaml": "WO-009",
    "container_kms_inventory.yaml": "WO-010",
    "ce_fips_build_tag_verification.yaml": "WO-011",
}


class MergeError(Exception):
    """Raised when a sub-inventory file is missing or does not match the
    shape this merge script expects. Callers should treat this as fatal —
    per WO-019's edge_cases, a malformed/missing source file must fail the
    merge with a descriptive error, not produce a partial artifact."""


def load_yaml(name):
    path = INVENTORY_DIR / name
    if not path.exists():
        raise MergeError(f"required sub-inventory file is missing: {path}")
    with open(path, encoding="utf-8") as f:
        try:
            doc = yaml.safe_load(f)
        except yaml.YAMLError as exc:
            raise MergeError(f"malformed YAML in {path}: {exc}") from exc
    if doc is None:
        raise MergeError(f"{path} parsed to an empty document")
    return doc


def tag(entry, source_file, work_order, **extra):
    if not isinstance(entry, dict):
        raise MergeError(
            f"{source_file}: expected a mapping entry, got {type(entry).__name__}: {entry!r}"
        )
    out = dict(entry)
    out["source_file"] = f"fips/inventory/{source_file}"
    out["source_work_order"] = work_order
    out.update(extra)
    return out


# ---------------------------------------------------------------------------
# Per-source-file extraction — each of the four call-site files uses a
# different top-level shape (flat array, {entries: [...]}, or
# {engines|methods: {name: {entries: [...]}}}), matching the three distinct
# schemas WO-005/WO-006 and WO-007 independently produced.
# ---------------------------------------------------------------------------

def extract_keysutil_call_sites():
    name = "keysutil_policy_crypto_sites.yaml"
    doc = load_yaml(name)
    if not isinstance(doc, list):
        raise MergeError(f"{name}: expected a top-level YAML array of entries")
    return [tag(e, name, SOURCE_WORK_ORDERS[name]) for e in doc]


def extract_core_barrier_seal_call_sites():
    name = "core_barrier_seal_crypto_sites.yaml"
    doc = load_yaml(name)
    entries = doc.get("entries") if isinstance(doc, dict) else None
    if not isinstance(entries, list):
        raise MergeError(f"{name}: expected a top-level 'entries' list")
    return [tag(e, name, SOURCE_WORK_ORDERS[name]) for e in entries]


def extract_builtin_call_sites(name, group_key):
    doc = load_yaml(name)
    groups = doc.get(group_key) if isinstance(doc, dict) else None
    if not isinstance(groups, dict):
        raise MergeError(f"{name}: expected a top-level '{group_key}' mapping")
    out = []
    for group_name, group in groups.items():
        entries = group.get("entries") if isinstance(group, dict) else None
        if not isinstance(entries, list):
            raise MergeError(f"{name}: {group_key}.{group_name} is missing an 'entries' list")
        for e in entries:
            out.append(
                tag(
                    e,
                    name,
                    SOURCE_WORK_ORDERS[name],
                    engine_or_method=e.get("engine_or_method", group_name),
                )
            )
    return out


def build_crypto_call_sites():
    call_sites = []
    call_sites += extract_keysutil_call_sites()
    call_sites += extract_core_barrier_seal_call_sites()
    call_sites += extract_builtin_call_sites("builtin_logical_crypto_sites.yaml", "engines")
    call_sites += extract_builtin_call_sites("builtin_credential_crypto_sites.yaml", "methods")
    return call_sites


def build_tls_configurations():
    name = "tls_listener_config.yaml"
    doc = load_yaml(name)
    entries = doc.get("entries") if isinstance(doc, dict) else None
    if not isinstance(entries, list):
        raise MergeError(f"{name}: expected a top-level 'entries' list")
    return [tag(e, name, SOURCE_WORK_ORDERS[name]) for e in entries]


def build_crypto_dependencies():
    name = "crypto_dependencies.yaml"
    doc = load_yaml(name)
    entries = doc.get("entries") if isinstance(doc, dict) else None
    if not isinstance(entries, list):
        raise MergeError(f"{name}: expected a top-level 'entries' list")
    return {
        "entries": [tag(e, name, SOURCE_WORK_ORDERS[name]) for e in entries],
        "excluded_graph_only_nodes": doc.get("excluded_graph_only_nodes", {}),
        "pkcs11_boundary_confirmation": doc.get("pkcs11_boundary_confirmation", {}),
    }


def build_container_and_kms():
    name = "container_kms_inventory.yaml"
    doc = load_yaml(name)
    images = doc.get("container_images") if isinstance(doc, dict) else None
    if not isinstance(images, list):
        raise MergeError(f"{name}: expected a top-level 'container_images' list")
    kms = doc.get("kms_hsm_seal_integrations") if isinstance(doc, dict) else None
    if not isinstance(kms, list):
        raise MergeError(f"{name}: expected a top-level 'kms_hsm_seal_integrations' list")

    container_images = {
        "entries": [tag(e, name, SOURCE_WORK_ORDERS[name]) for e in images],
        "enterprise_only_fips_images": doc.get("enterprise_only_fips_images", {}),
    }
    kms_integrations = {
        "entries": [tag(e, name, SOURCE_WORK_ORDERS[name]) for e in kms],
        "non_kms_seals": doc.get("non_kms_seals", []),
        "validation": doc.get("validation", {}),
    }
    return container_images, kms_integrations


def build_build_tag_verification():
    name = "ce_fips_build_tag_verification.yaml"
    doc = load_yaml(name)
    if not isinstance(doc, dict):
        raise MergeError(f"{name}: expected a top-level mapping")
    out = dict(doc)
    out["source_file"] = f"fips/inventory/{name}"
    out["source_work_order"] = SOURCE_WORK_ORDERS[name]
    return out


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------

def get_git_sha():
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return "unknown"


def get_vault_version():
    version_file = REPO_ROOT / "version" / "VERSION"
    try:
        content = version_file.read_text(encoding="utf-8").strip()
        if content:
            return content
    except OSError:
        pass
    go_version_file = REPO_ROOT / ".go-version"
    try:
        content = go_version_file.read_text(encoding="utf-8").strip()
        if content:
            return f"unknown (fallback: .go-version toolchain {content})"
    except OSError:
        pass
    return "unknown"


def build_metadata():
    return {
        "generation_date": datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "source_commit_sha": get_git_sha(),
        "vault_version": get_vault_version(),
        "inventory_schema_version": INVENTORY_SCHEMA_VERSION,
        "source_inventories": [
            {"file": f"fips/inventory/{name}", "work_order": wo}
            for name, wo in SOURCE_WORK_ORDERS.items()
        ],
    }


# ---------------------------------------------------------------------------
# Summary statistics — recomputed on every run, never cached or hardcoded.
# ---------------------------------------------------------------------------

def compute_summary(call_sites):
    total = len(call_sites)
    fips_approved = sum(1 for e in call_sites if e.get("fips_approved") is True)
    non_approved = sum(1 for e in call_sites if e.get("fips_approved") is False)
    security_relevant = sum(1 for e in call_sites if e.get("security_relevant") is True)
    non_security_relevant = sum(1 for e in call_sites if e.get("security_relevant") is False)
    enterprise_only = sum(1 for e in call_sites if e.get("enterprise_only") is True)

    by_module_boundary = {b: 0 for b in MODULE_BOUNDARIES}
    entries_without_module_boundary = 0
    for e in call_sites:
        mb = e.get("module_boundary")
        if mb in by_module_boundary:
            by_module_boundary[mb] += 1
        else:
            entries_without_module_boundary += 1

    return {
        "total_crypto_call_sites": total,
        "fips_approved_count": fips_approved,
        "non_approved_count": non_approved,
        "security_relevant_count": security_relevant,
        "non_security_relevant_count": non_security_relevant,
        "enterprise_only_count": enterprise_only,
        "by_module_boundary": by_module_boundary,
        "entries_without_module_boundary_classification": entries_without_module_boundary,
    }


_NULLISH = {"", "n/a", "none", "n/a (import only)"}


def _has_value(v):
    return bool(v) and str(v).strip().lower() not in _NULLISH


# ---------------------------------------------------------------------------
# Quality gates — PASS/PARTIAL/FAIL/BLOCKED only; never rounds up to PASS
# when some, but not all, entries in a category are complete.
# ---------------------------------------------------------------------------

def compute_quality_gates(call_sites, crypto_deps, container_images, kms_integrations):
    # FIPS-CRYPTO-001: every call site identifies file + algorithm + library.
    identified = []
    unidentified = []
    for e in call_sites:
        if _has_value(e.get("file")) and _has_value(e.get("algorithm")) and _has_value(e.get("library")):
            identified.append(e)
        else:
            unidentified.append(
                f"{e.get('source_file')}::{e.get('engine_or_method', e.get('function', 'unknown'))}"
            )
    if len(identified) == len(call_sites):
        crypto_status = "PASS"
    elif identified:
        crypto_status = "PARTIAL"
    else:
        crypto_status = "FAIL"
    crypto_gate = {
        "name": "Cryptographic module identification",
        "status": crypto_status,
        "evidence": (
            f"crypto_call_sites: {len(identified)}/{len(call_sites)} entries have a fully "
            "identified file+algorithm+library triple. The shortfall is the documented "
            "'not_present_in_repo' / 'no_direct_imports' placeholder rows for externalized "
            "secrets-engine/auth-method plugins (e.g. kv, gcp, azure, ldap, terraform, ad, "
            "alicloud) in builtin_logical_crypto_sites.yaml and "
            "builtin_credential_crypto_sites.yaml — these document a real absence of "
            "vendored source rather than an unclassified call site. See "
            "unidentified_entries for the exact list."
        ),
        "unidentified_entries": unidentified,
    }

    # FIPS-DEP-001: every crypto dependency carries the full classification field set.
    dep_required_fields = [
        "module_path",
        "version",
        "direct_or_transitive",
        "crypto_operations",
        "fips_approved_algorithms",
        "non_approved_algorithms",
        "consolidation_finding",
    ]
    dep_entries = crypto_deps["entries"]
    dep_complete = [d for d in dep_entries if all(f in d for f in dep_required_fields)]
    dep_status = "PASS" if dep_entries and len(dep_complete) == len(dep_entries) else (
        "PARTIAL" if dep_complete else "FAIL"
    )
    dep_gate = {
        "name": "Cryptographic dependency identification",
        "status": dep_status,
        "evidence": (
            f"crypto_dependencies.entries: {len(dep_complete)}/{len(dep_entries)} module "
            "entries carry the full FIPS-DEP-001 classification field set (module_path, "
            "version, direct_or_transitive, crypto_operations, fips_approved_algorithms, "
            "non_approved_algorithms, consolidation_finding). The duplicate go-jose/"
            "golang-jwt major-version findings are a dependency-hygiene gap tracked in "
            "residual_gaps, not a classification-completeness gap."
        ),
    }

    # FIPS-CONTAINER-001: every deployment-path image and KMS/HSM integration has a
    # definitive CMVP/FIPS-readiness classification (not merely "requires lookup").
    img_entries = container_images["entries"]
    img_definitive = [
        i for i in img_entries
        if i.get("cmvp_status") not in (None, "fips_path_candidate_requires_runtime_verification")
    ]
    kms_entries = kms_integrations["entries"]
    _unresolved_cmvp = {
        "requires_external_lookup",
        "CMVP status unknown — requires vendor confirmation",
    }
    kms_definitive = [
        k for k in kms_entries
        if isinstance(k.get("cmvp_certificate"), str) and k.get("cmvp_certificate") not in _unresolved_cmvp
    ]
    container_total = len(img_entries) + len(kms_entries)
    container_definitive_count = len(img_definitive) + len(kms_definitive)
    if container_total and container_definitive_count == container_total:
        container_status = "PASS"
    elif container_definitive_count:
        container_status = "PARTIAL"
    else:
        container_status = "FAIL"
    container_gate = {
        "name": "Container and KMS/HSM classification",
        "status": container_status,
        "evidence": (
            f"container_images.entries: {len(img_definitive)}/{len(img_entries)} images have a "
            "definitive cmvp_status (ce-ubi10-minimal is "
            "fips_path_candidate_requires_runtime_verification, not a definitive status); "
            f"kms_integrations.entries: {len(kms_definitive)}/{len(kms_entries)} providers have a "
            "resolved cmvp_certificate (AWS KMS/Azure Key Vault/GCP Cloud KMS are "
            "requires_external_lookup; AliCloud KMS/OCI KMS are CMVP status unknown). Every "
            "image and provider IS classified by role/wiring — the gate is PARTIAL because "
            "their CMVP validation status is not fully confirmed in-repo, per residual_gaps."
        ),
    }

    return {
        "FIPS-CRYPTO-001": crypto_gate,
        "FIPS-DEP-001": dep_gate,
        "FIPS-CONTAINER-001": container_gate,
    }


# ---------------------------------------------------------------------------
# Residual gaps — every item below cites a real entry already present in one
# of the eight source inventory files; nothing here is newly discovered.
# ---------------------------------------------------------------------------

def build_residual_gaps():
    return [
        {
            "id": "RG-1",
            "title": "TLS 1.0/1.1 remain configurable on the client API listener",
            "phase": "Phase 2",
            "evidence": [
                "fips/inventory/tls_listener_config.yaml#listener-tls-min-version",
                "fips/inventory/tls_listener_config.yaml#listener-tls-max-version",
                "internalshared/configutil/listener.go:75-76",
            ],
            "description": (
                "tls_min_version/tls_max_version accept tls10/tls11 for the client API "
                "listener (port 8200); no FIPS floor of tls12 is enforced at configuration "
                "time."
            ),
        },
        {
            "id": "RG-2",
            "title": "ChaCha20-Poly1305 is exercised on security-relevant paths",
            "phase": "Phase 2",
            "evidence": [
                "fips/inventory/keysutil_policy_crypto_sites.yaml (KeyType_ChaCha20_Poly1305, policy.go:69,2212,2292)",
                "fips/inventory/core_barrier_seal_crypto_sites.yaml (vault/core.go:1292-1315 default cluster cipher suites)",
                "fips/inventory/tls_listener_config.yaml#cluster-cipher-suites",
                "fips/inventory/builtin_logical_crypto_sites.yaml (builtin/logical/pki/acme_challenges.go:540-554)",
            ],
            "description": (
                "ChaCha20-Poly1305 is not FIPS 140-3 Approved but is selectable as a Transit "
                "AEAD KeyType, appears in the default cluster (port 8201) TLS cipher-suite "
                "list, and is offered in the PKI ACME TLS-ALPN-01 challenge client's cipher "
                "allowlist."
            ),
        },
        {
            "id": "RG-3",
            "title": "Ed25519 is exercised on security-relevant paths",
            "phase": "Phase 2",
            "evidence": [
                "fips/inventory/keysutil_policy_crypto_sites.yaml (KeyType_ED25519, policy.go:66 and its sign/verify/genkey call sites)",
                "fips/inventory/builtin_logical_crypto_sites.yaml (pki/path_root.go:773-828, pki/issuing/signing_utils.go:82-155, database/credentials.go:303-381, ssh/path_config_ca.go:356-455)",
            ],
            "description": (
                "Ed25519 is not on the FIPS 186-5 Approved signature-algorithm list "
                "(non-NIST curve) but is a selectable KeyType/key_type across Transit, PKI "
                "CA/CSR issuance, database client-certificate auth, and the SSH secrets "
                "engine's CA key type."
            ),
        },
        {
            "id": "RG-4",
            "title": "SHA-3 is excluded from the FIPS-validated boundary under boringcrypto builds",
            "phase": "Phase 2/3",
            "evidence": [
                "fips/inventory/keysutil_policy_crypto_sites.yaml (sdk/helper/keysutil/consts.go:61 HashFuncMap/CryptoHashMap; policy.go:1384,1602)",
            ],
            "description": (
                "SHA3-224/256/384/512 are selectable RSA-PSS/PKCS1v15/OAEP hash functions in "
                "sdk/helper/keysutil, but sdk/helper/keysutil/policy_test.go documents that "
                "Go's boringcrypto FIPS build does not support SHA-3."
            ),
        },
        {
            "id": "RG-5",
            "title": "Shamir's Secret Sharing is not a FIPS-Approved mechanism",
            "phase": "Phase 2/3",
            "evidence": [
                "fips/inventory/core_barrier_seal_crypto_sites.yaml (vault/rekey.go shamir.Split/Combine; vault/seal/seal.go:817-845 SetShamirSealKey/GetShamirKeyBytes)",
                "fips/inventory/container_kms_inventory.yaml#non_kms_seals",
            ],
            "description": (
                "Shamir's Secret Sharing — Vault's default manual-unseal mechanism when no "
                "KMS auto-unseal is configured — does not appear on the NIST SP 800-140C/D "
                "Approved list. FIPS-path deployments should use a KMS/HSM auto-unseal "
                "provider instead."
            ),
        },
        {
            "id": "RG-6",
            "title": "CMVP certificates for configured KMS/HSM backends are not tracked in-repo",
            "phase": "Phase 3",
            "evidence": [
                "fips/inventory/container_kms_inventory.yaml#kms_hsm_seal_integrations",
            ],
            "description": (
                "AWS KMS, Azure Key Vault, and GCP Cloud KMS wrapper integrations are "
                "recorded as cmvp_certificate: requires_external_lookup, and AliCloud KMS/"
                "OCI KMS as CMVP status unknown — no NIST CMVP certificate number is pinned "
                "in-repo for any of the five external KMS/HSM providers Vault can "
                "auto-unseal against."
            ),
        },
        {
            "id": "RG-7",
            "title": "Duplicate go-jose and golang-jwt major-version dependencies",
            "phase": "Phase 2",
            "evidence": [
                "fips/inventory/crypto_dependencies.yaml (github.com/go-jose/go-jose/v3 v3.0.5 + github.com/go-jose/go-jose/v4 v4.1.5)",
                "fips/inventory/crypto_dependencies.yaml (github.com/golang-jwt/jwt/v4 v4.5.2 + github.com/golang-jwt/jwt/v5 v5.3.1)",
            ],
            "description": (
                "Both go-jose (v3 and v4) and golang-jwt (v4 and v5) coexist in the module "
                "graph; each pairing carries consolidation_finding: 'Duplicate major "
                "versions — consolidation recommended for dependency hygiene' in "
                "crypto_dependencies.yaml."
            ),
        },
    ]


HEADER = """\
# FIPS 140-3 Consolidated Cryptographic Inventory
#
# WO-019 (capstone of FIPS Phase 1 — Cryptographic Inventory and Discovery)
# Generated by fips/scripts/merge_inventory.py from the eight sub-inventory
# files under fips/inventory/ (WO-005 through WO-011). Do not hand-edit this
# file — re-run the merge script instead so summary counts and quality gate
# statuses stay in sync with the source inventories.
#
# Validate with: fips/scripts/validate_consolidated_inventory.sh
#
# Satisfies quality gates: FIPS-CRYPTO-001, FIPS-DEP-001, FIPS-CONTAINER-001.
# Consumed by Phase 2 (Approved-Algorithm Configuration) for remediation
# targeting and by Phase 4 CI enforcement gates.
"""


def build_consolidated_document():
    call_sites = build_crypto_call_sites()
    tls_configurations = build_tls_configurations()
    crypto_dependencies = build_crypto_dependencies()
    container_images, kms_integrations = build_container_and_kms()
    build_tag_verification = build_build_tag_verification()

    summary = compute_summary(call_sites)
    quality_gates = compute_quality_gates(
        call_sites, crypto_dependencies, container_images, kms_integrations
    )
    residual_gaps = build_residual_gaps()

    return {
        "metadata": build_metadata(),
        "crypto_call_sites": call_sites,
        "tls_configurations": tls_configurations,
        "crypto_dependencies": crypto_dependencies,
        "container_images": container_images,
        "kms_integrations": kms_integrations,
        "build_tag_verification": build_tag_verification,
        "summary": summary,
        "quality_gates": quality_gates,
        "residual_gaps": residual_gaps,
    }


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Compute the merge and print the summary without writing fips/crypto_inventory.yaml",
    )
    args = parser.parse_args(argv[1:])

    try:
        doc = build_consolidated_document()
    except MergeError as exc:
        print(f"ERROR: merge failed: {exc}", file=sys.stderr)
        return 1

    summary = doc["summary"]
    print("FIPS Phase 1 consolidated inventory merge:")
    print(f"  total_crypto_call_sites:        {summary['total_crypto_call_sites']}")
    print(f"  fips_approved_count:             {summary['fips_approved_count']}")
    print(f"  non_approved_count:              {summary['non_approved_count']}")
    print(f"  security_relevant_count:        {summary['security_relevant_count']}")
    print(f"  non_security_relevant_count:     {summary['non_security_relevant_count']}")
    print(f"  enterprise_only_count:           {summary['enterprise_only_count']}")
    print(f"  by_module_boundary:              {summary['by_module_boundary']}")
    for gate_id, gate in doc["quality_gates"].items():
        print(f"  quality_gate {gate_id}: {gate['status']}")

    if args.check:
        print("\n--check specified: fips/crypto_inventory.yaml was NOT written.")
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(HEADER)
        yaml.safe_dump(doc, f, sort_keys=False, default_flow_style=False, width=100, allow_unicode=True)

    print(f"\nWrote {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
