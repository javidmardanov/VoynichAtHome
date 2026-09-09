"""Load, validate, canonicalize, and identify Voynich@Home contracts."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from datetime import datetime
from importlib import resources
from pathlib import Path
from typing import Any

import rfc8785
from jsonschema import Draft202012Validator, FormatChecker

SCHEMAS = {
    "corpus-snapshot": "corpus-snapshot.schema.json",
    "experiment": "experiment.schema.json",
    "work-unit": "work-unit.schema.json",
    "result-envelope": "result-envelope.schema.json",
    "validation-record": "validation-record.schema.json",
}


class ContractError(ValueError):
    """A document does not satisfy its contract or content identity."""


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ContractError(f"duplicate JSON object key is forbidden: {key!r}")
        result[key] = value
    return result


def load_json(path: str | Path) -> Any:
    """Load strict UTF-8 JSON without duplicate keys or non-finite numbers."""

    source = Path(path)
    try:
        with source.open("r", encoding="utf-8") as handle:
            return json.load(
                handle,
                object_pairs_hook=_unique_object,
                parse_constant=lambda value: (_ for _ in ()).throw(
                    ContractError(f"non-finite JSON number is forbidden: {value}")
                ),
            )
    except json.JSONDecodeError as error:
        raise ContractError(f"invalid JSON in {source}: {error}") from error


def load_schema(kind: str) -> Mapping[str, Any]:
    """Load one packaged JSON Schema by its public contract name."""

    try:
        filename = SCHEMAS[kind]
    except KeyError as error:
        choices = ", ".join(sorted(SCHEMAS))
        raise ContractError(
            f"unknown contract kind {kind!r}; choose one of: {choices}"
        ) from error

    schema_resource = resources.files("voynich_at_home.schemas").joinpath(filename)
    return json.loads(schema_resource.read_text(encoding="utf-8"))


def validate_document(kind: str, document: Any) -> None:
    """Validate a document and report all failures in stable path order."""

    schema = load_schema(kind)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(
        validator.iter_errors(document),
        key=lambda item: (
            tuple(str(part) for part in item.absolute_path),
            item.message,
        ),
    )
    if not errors:
        _validate_semantics(kind, document)
        return

    messages: list[str] = []
    for error in errors:
        path = "/" + "/".join(str(part) for part in error.absolute_path)
        messages.append(f"{path or '/'}: {error.message}")
    raise ContractError("contract validation failed:\n" + "\n".join(messages))


def _require_unique(values: list[str], label: str) -> None:
    if len(values) != len(set(values)):
        raise ContractError(f"semantic validation failed: {label} must be unique")


def _validate_semantics(kind: str, document: Any) -> None:
    if not isinstance(document, Mapping):
        return

    if kind == "corpus-snapshot":
        source_ids = [item["source_id"] for item in document["sources"]]
        transformation_ids = [
            item["transformation_id"] for item in document["transformations"]
        ]
        output_ids = [
            item["output"]["artifact_id"] for item in document["transformations"]
        ]
        view_ids = [item["view_id"] for item in document["views"]]
        _require_unique(source_ids, "source IDs")
        _require_unique(transformation_ids, "transformation IDs")
        _require_unique(output_ids, "transformation output IDs")
        _require_unique(view_ids, "view IDs")
        _require_unique(source_ids + output_ids, "source and output artifact IDs")
        known_artifacts = set(source_ids + output_ids)
        for transformation in document["transformations"]:
            unknown = set(transformation["inputs"]) - known_artifacts
            if unknown:
                raise ContractError(
                    "semantic validation failed: transformation inputs are unknown: "
                    + ", ".join(sorted(unknown))
                )
        for view in document["views"]:
            unknown = set(view["input_artifact_ids"]) - known_artifacts
            if unknown:
                raise ContractError(
                    "semantic validation failed: corpus-view inputs are unknown: "
                    + ", ".join(sorted(unknown))
                )

    elif kind == "experiment":
        validation = document["validation"]
        initial = validation["initial_replicas"]
        quorum = validation["quorum"]
        maximum = validation["max_replicas"]
        if not quorum <= initial <= maximum:
            raise ContractError(
                "semantic validation failed: require quorum <= initial_replicas <= max_replicas"
            )
        _require_unique(
            [item["metric_id"] for item in document["metrics"]], "metric IDs"
        )
        _require_unique(
            [item["control_id"] for item in document["controls"]], "control IDs"
        )
        candidate_count = document["search"]["candidate_count"]
        shard_size = document["search"]["shard_size"]
        minimum_units = (candidate_count + shard_size - 1) // shard_size
        if document["stopping_rule"]["max_work_units"] < minimum_units:
            raise ContractError(
                "semantic validation failed: max_work_units cannot cover the declared search space"
            )

    elif kind == "work-unit":
        partition = document["partition"]
        is_control = partition["role"] == "control"
        has_control_id = partition["control_id"] is not None
        if is_control != has_control_id:
            raise ContractError(
                "semantic validation failed: control role and control_id must be present together"
            )
        _require_unique(
            [item["artifact_id"] for item in document["inputs"]], "input artifact IDs"
        )
        _require_unique(
            [item["logical_name"] for item in document["inputs"]], "input logical names"
        )

    elif kind == "result-envelope":
        started = datetime.fromisoformat(document["started_at"])
        finished = datetime.fromisoformat(document["finished_at"])
        if finished < started:
            raise ContractError(
                "semantic validation failed: finished_at must not precede started_at"
            )

    elif kind == "validation-record":
        result_ids = document["result_ids"]
        output_digests = document["result_output_digests"]
        if len(result_ids) != len(output_digests):
            raise ContractError(
                "semantic validation failed: result_ids and result_output_digests lengths differ"
            )
        if document["quorum"] > len(result_ids):
            raise ContractError(
                "semantic validation failed: quorum exceeds the number of result envelopes"
            )
        canonical = document["canonical_output_digest"]
        if (
            document["decision"] == "canonical"
            and output_digests.count(canonical) < document["quorum"]
        ):
            raise ContractError(
                "semantic validation failed: canonical output does not have the declared quorum"
            )


def canonical_bytes(document: Any) -> bytes:
    """Serialize a JSON-compatible value with RFC 8785 canonicalization."""

    try:
        return rfc8785.dumps(document)
    except (rfc8785.CanonicalizationError, TypeError) as error:
        raise ContractError(f"document cannot be canonicalized: {error}") from error


def content_digest(document: Any) -> str:
    """Return the SHA-256 identity of a canonical JSON value."""

    digest = hashlib.sha256(canonical_bytes(document)).hexdigest()
    return f"sha256:{digest}"


def work_unit_identity(document: Mapping[str, Any]) -> str:
    """Hash the work-unit identity object without its self-referential ID."""

    identity_document = {
        key: value for key, value in document.items() if key != "work_unit_id"
    }
    return content_digest(identity_document)


def verify_work_unit(document: Any) -> str:
    """Validate a work unit and verify its content-derived identifier."""

    validate_document("work-unit", document)
    if not isinstance(document, Mapping):
        raise ContractError("work unit must be a JSON object")

    expected = work_unit_identity(document)
    actual = document["work_unit_id"]
    if actual != expected:
        raise ContractError(f"work_unit_id mismatch: got {actual}; expected {expected}")
    return expected


def _raw_file_digest(path: Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def verify_bundle(path: str | Path) -> dict[str, int]:
    """Verify cross-document identities and referenced artifacts in a bundle."""

    bundle_path = Path(path)
    bundle = load_json(bundle_path)
    if not isinstance(bundle, Mapping):
        raise ContractError("bundle manifest must be a JSON object")
    expected_keys = {
        "schema_version",
        "corpus_snapshot",
        "experiment",
        "work_units",
        "result_envelopes",
        "validation_records",
        "artifacts",
    }
    if set(bundle) != expected_keys or bundle["schema_version"] != "1.0.0":
        raise ContractError("bundle manifest has an unknown version or field set")

    base = bundle_path.parent

    def resolve(relative: str) -> Path:
        candidate = (base / relative).resolve()
        if not candidate.is_file():
            raise ContractError(f"bundle file is missing: {relative}")
        return candidate

    corpus = load_json(resolve(bundle["corpus_snapshot"]))
    experiment = load_json(resolve(bundle["experiment"]))
    work_units = [load_json(resolve(item)) for item in bundle["work_units"]]
    results = [load_json(resolve(item)) for item in bundle["result_envelopes"]]
    validations = [load_json(resolve(item)) for item in bundle["validation_records"]]

    validate_document("corpus-snapshot", corpus)
    validate_document("experiment", experiment)
    for document in work_units:
        verify_work_unit(document)
    for document in results:
        validate_document("result-envelope", document)
    for document in validations:
        validate_document("validation-record", document)

    artifacts: dict[str, list[Path]] = {}
    for item in bundle["artifacts"]:
        if not isinstance(item, Mapping) or set(item) != {"path", "digest_mode"}:
            raise ContractError(
                "each bundle artifact needs exactly path and digest_mode"
            )
        artifact_path = resolve(item["path"])
        if item["digest_mode"] == "raw":
            digest = _raw_file_digest(artifact_path)
        elif item["digest_mode"] == "canonical-json":
            digest = content_digest(load_json(artifact_path))
        else:
            raise ContractError(f"unknown artifact digest mode: {item['digest_mode']}")
        artifacts.setdefault(digest, []).append(artifact_path)

    def require_artifact(
        digest: str, context: str, expected_bytes: int | None = None
    ) -> None:
        if digest not in artifacts:
            raise ContractError(f"bundle does not resolve {context} digest {digest}")
        if expected_bytes is not None and all(
            candidate.stat().st_size != expected_bytes
            for candidate in artifacts[digest]
        ):
            raise ContractError(f"bundle has the wrong byte length for {context}")

    corpus_digest = content_digest(corpus)
    experiment_digest = content_digest(experiment)
    artifacts.setdefault(corpus_digest, []).append(resolve(bundle["corpus_snapshot"]))
    artifacts.setdefault(experiment_digest, []).append(resolve(bundle["experiment"]))

    for source in corpus["sources"]:
        require_artifact(
            f"sha256:{source['sha256']}",
            f"source {source['source_id']}",
            source["bytes"],
        )
    for transformation in corpus["transformations"]:
        require_artifact(
            transformation["tool"]["source_digest"],
            f"transformation {transformation['transformation_id']} tool",
        )
        output = transformation["output"]
        require_artifact(
            f"sha256:{output['sha256']}",
            f"output {output['artifact_id']}",
            output["bytes"],
        )
    for view in corpus["views"]:
        require_artifact(f"sha256:{view['artifact_sha256']}", f"view {view['view_id']}")

    if experiment["corpus"]["snapshot_digest"] != corpus_digest:
        raise ContractError(
            "experiment corpus digest does not identify the bundled snapshot"
        )
    require_artifact(experiment["partitions"]["manifest_digest"], "partition manifest")
    for metric in experiment["metrics"]:
        require_artifact(
            metric["implementation_digest"], f"metric {metric['metric_id']}"
        )
    for control in experiment["controls"]:
        require_artifact(control["artifact_digest"], f"control {control['control_id']}")
    require_artifact(
        experiment["search"]["implementation_digest"], "search implementation"
    )
    require_artifact(experiment["worker"]["artifact_digest"], "worker")
    require_artifact(
        experiment["worker"]["output_schema_digest"], "worker output schema"
    )

    work_units_by_id: dict[str, Mapping[str, Any]] = {}
    for work_unit in work_units:
        work_unit_id = work_unit["work_unit_id"]
        if work_unit_id in work_units_by_id:
            raise ContractError(f"duplicate bundled work unit: {work_unit_id}")
        work_units_by_id[work_unit_id] = work_unit
        if work_unit["experiment_digest"] != experiment_digest:
            raise ContractError(
                f"work unit {work_unit_id} has the wrong experiment digest"
            )
        if (
            work_unit["worker"]["artifact_digest"]
            != experiment["worker"]["artifact_digest"]
        ):
            raise ContractError(f"work unit {work_unit_id} has the wrong worker digest")
        if (
            work_unit["output_contract"]["schema_digest"]
            != experiment["worker"]["output_schema_digest"]
        ):
            raise ContractError(
                f"work unit {work_unit_id} has the wrong output schema digest"
            )
        require_artifact(work_unit["compiler"]["source_digest"], "work-unit compiler")
        require_artifact(work_unit["checkpoint"]["schema_digest"], "checkpoint schema")
        for input_artifact in work_unit["inputs"]:
            require_artifact(
                f"sha256:{input_artifact['sha256']}",
                f"work-unit input {input_artifact['artifact_id']}",
                input_artifact["bytes"],
            )
        for resource, limit in experiment["worker"]["resource_limits"].items():
            if work_unit["resources"][resource] > limit:
                raise ContractError(f"work unit {work_unit_id} exceeds {resource}")

    results_by_id: dict[str, Mapping[str, Any]] = {}
    for result in results:
        result_id = result["result_id"]
        if result_id in results_by_id:
            raise ContractError(f"duplicate bundled result: {result_id}")
        results_by_id[result_id] = result
        work_unit = work_units_by_id.get(result["work_unit_id"])
        if work_unit is None:
            raise ContractError(f"result {result_id} names an unknown work unit")
        if result["experiment_digest"] != experiment_digest:
            raise ContractError(f"result {result_id} has the wrong experiment digest")
        if result["worker_artifact_digest"] != work_unit["worker"]["artifact_digest"]:
            raise ContractError(f"result {result_id} has the wrong worker digest")
        expected_inputs = [f"sha256:{item['sha256']}" for item in work_unit["inputs"]]
        if result["input_digests"] != expected_inputs:
            raise ContractError(f"result {result_id} has the wrong input digests")
        if result["output"] is not None:
            output = result["output"]
            if (
                output["logical_name"] != work_unit["output_contract"]["logical_name"]
                or output["media_type"] != work_unit["output_contract"]["media_type"]
            ):
                raise ContractError(f"result {result_id} violates its output contract")
            require_artifact(
                f"sha256:{output['sha256']}",
                f"result {result_id} output",
                output["bytes"],
            )

    for validation in validations:
        work_unit = work_units_by_id.get(validation["work_unit_id"])
        if work_unit is None or validation["experiment_digest"] != experiment_digest:
            raise ContractError(
                f"validation {validation['validation_id']} has an unknown identity"
            )
        require_artifact(validation["validator_artifact_digest"], "validator")
        for result_id, output_digest in zip(
            validation["result_ids"], validation["result_output_digests"], strict=True
        ):
            result = results_by_id.get(result_id)
            if result is None or result["work_unit_id"] != work_unit["work_unit_id"]:
                raise ContractError(f"validation names an unknown result: {result_id}")
            actual_output = (
                None
                if result["output"] is None
                else f"sha256:{result['output']['sha256']}"
            )
            if output_digest != actual_output:
                raise ContractError(
                    f"validation output digest disagrees for result: {result_id}"
                )

    return {
        "work_units": len(work_units),
        "results": len(results),
        "validations": len(validations),
        "artifacts": sum(len(paths) for paths in artifacts.values()),
    }
