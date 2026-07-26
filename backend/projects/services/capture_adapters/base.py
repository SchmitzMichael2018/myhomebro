from dataclasses import dataclass, field


class CaptureAdapterError(ValueError):
    code = "capture_adapter_error"


@dataclass
class AdapterContext:
    capture: object
    snapshot: dict
    actor: object
    options: dict
    records: dict = field(default_factory=dict)
    created_records: list = field(default_factory=list)
    linked_records: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


class CaptureDestinationAdapter:
    name = ""
    version = "1"

    def validate(self, context):
        return None

    def authorize(self, context):
        return None

    def find_conflicts(self, context):
        return []

    def preview(self, context):
        raise NotImplementedError

    def apply(self, context, idempotency_key):
        raise NotImplementedError

    def build_receipt(self, context):
        return {
            "adapter": self.name,
            "version": self.version,
        }

