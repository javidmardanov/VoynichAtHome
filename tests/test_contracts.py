from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from voynich_at_home.contracts import (
    ContractError,
    canonical_bytes,
    content_digest,
    load_json,
    validate_document,
    verify_bundle,
    verify_work_unit,
    work_unit_identity,
)

ROOT = Path(__file__).parents[1]
EXAMPLES = ROOT / "examples"


@pytest.mark.parametrize(
    ("kind", "filename"),
    [
        ("corpus-snapshot", "corpus-snapshot.synthetic.json"),
        ("experiment", "experiment.known-cipher.json"),
        ("work-unit", "work-unit.known-cipher.000000.json"),
        ("result-envelope", "result-envelope.known-cipher.000000.json"),
        ("result-envelope", "result-envelope.known-cipher.000000.replica2.json"),
        ("validation-record", "validation-record.known-cipher.000000.json"),
    ],
)
def test_examples_validate(kind: str, filename: str) -> None:
    validate_document(kind, load_json(EXAMPLES / filename))


def test_canonical_identity_is_independent_of_object_key_order() -> None:
    left = {"z": [3, 2, 1], "a": {"truth": True, "count": 4}}
    right = {"a": {"count": 4, "truth": True}, "z": [3, 2, 1]}

    assert canonical_bytes(left) == canonical_bytes(right)
    assert content_digest(left) == content_digest(right)


def test_work_unit_identity_is_not_self_referential() -> None:
    work_unit = load_json(EXAMPLES / "work-unit.known-cipher.000000.json")

    assert verify_work_unit(work_unit) == work_unit["work_unit_id"]
    changed_id = copy.deepcopy(work_unit)
    changed_id["work_unit_id"] = "sha256:" + "0" * 64
    assert work_unit_identity(changed_id) == work_unit_identity(work_unit)


def test_modified_scientific_parameter_changes_work_unit_identity() -> None:
    work_unit = load_json(EXAMPLES / "work-unit.known-cipher.000000.json")
    modified = copy.deepcopy(work_unit)
    modified["parameters"]["key_range_end"] += 1

    assert work_unit_identity(modified) != work_unit["work_unit_id"]


def test_public_worker_cannot_request_network_access() -> None:
    experiment = load_json(EXAMPLES / "experiment.known-cipher.json")
    experiment["worker"]["network_access"] = True

    with pytest.raises(ContractError, match="False was expected"):
        validate_document("experiment", experiment)


def test_unknown_fields_are_rejected() -> None:
    result = load_json(EXAMPLES / "result-envelope.known-cipher.000000.json")
    result["host_ip"] = "192.0.2.1"

    with pytest.raises(ContractError, match="Additional properties"):
        validate_document("result-envelope", result)


def test_json_examples_are_canonicalizable() -> None:
    for path in sorted(EXAMPLES.glob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        assert canonical_bytes(document)


def test_duplicate_json_keys_are_rejected(tmp_path: Path) -> None:
    duplicate = tmp_path / "duplicate.json"
    duplicate.write_text(
        '{"work_unit_id":"first","work_unit_id":"second"}\n', encoding="utf-8"
    )

    with pytest.raises(ContractError, match="duplicate JSON object key"):
        load_json(duplicate)


def test_impossible_experiment_replica_settings_are_rejected() -> None:
    experiment = load_json(EXAMPLES / "experiment.known-cipher.json")
    experiment["validation"]["quorum"] = 3

    with pytest.raises(ContractError, match="quorum <= initial_replicas"):
        validate_document("experiment", experiment)


def test_control_role_requires_control_id() -> None:
    work_unit = load_json(EXAMPLES / "work-unit.known-cipher.000000.json")
    work_unit["partition"]["control_id"] = None

    with pytest.raises(ContractError, match="control role and control_id"):
        validate_document("work-unit", work_unit)


def test_result_timestamps_must_be_ordered() -> None:
    result = load_json(EXAMPLES / "result-envelope.known-cipher.000000.json")
    result["finished_at"] = "2026-08-30T19:49:59Z"

    with pytest.raises(ContractError, match="finished_at must not precede"):
        validate_document("result-envelope", result)


def test_canonical_validation_requires_real_quorum() -> None:
    validation = load_json(EXAMPLES / "validation-record.known-cipher.000000.json")
    validation["result_output_digests"][1] = "sha256:" + "f" * 64

    with pytest.raises(ContractError, match="does not have the declared quorum"):
        validate_document("validation-record", validation)


def test_complete_example_bundle_verifies() -> None:
    counts = verify_bundle(EXAMPLES / "bundle.synthetic.json")

    assert counts["work_units"] == 1
    assert counts["results"] == 2
    assert counts["validations"] == 1
