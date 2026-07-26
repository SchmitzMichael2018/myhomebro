from django.db import IntegrityError

from projects.models import Homeowner
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter
from projects.services.customer_accounts import normalize_customer_email, normalize_customer_phone


class CustomerAdapter(CaptureDestinationAdapter):
    name = "customer"

    def _person(self, context):
        return (context.snapshot.get("structured_draft") or {}).get("person") or {}

    def _decision(self, context):
        return (context.snapshot.get("review_decisions") or {}).get("duplicate") or {}

    def validate(self, context):
        person = self._person(context)
        if not str(person.get("name") or "").strip():
            raise CaptureAdapterError("Approved customer name is required.")
        decision = self._decision(context)
        required = any(
            row.get("match_strength") in {"exact", "strong"}
            for row in context.capture.duplicate_candidates or []
        )
        if required and decision.get("decision") not in {
            "link_existing", "create_separate", "not_same_person"
        }:
            raise CaptureAdapterError("Resolve the required customer duplicate before applying.")

    def _linked_customer(self, context):
        decision = self._decision(context)
        if decision.get("decision") != "link_existing":
            return None
        customer = Homeowner.objects.filter(
            created_by=context.capture.contractor,
            pk=decision.get("candidate_id"),
        ).first()
        if customer is None:
            raise CaptureAdapterError("The approved existing customer was not found.")
        return customer

    def find_conflicts(self, context):
        person = self._person(context)
        email = normalize_customer_email(person.get("email"))
        phone = normalize_customer_phone(person.get("phone"))
        warnings = []
        if email and Homeowner.objects.filter(
            created_by=context.capture.contractor, normalized_email=email
        ).exists():
            warnings.append("A customer with this email already exists.")
        if phone and Homeowner.objects.filter(
            created_by=context.capture.contractor, normalized_phone=phone
        ).exists():
            warnings.append("A customer with this phone number already exists.")
        return warnings

    def preview(self, context):
        self.validate(context)
        linked = self._linked_customer(context)
        person = self._person(context)
        if linked:
            context.records["customer"] = linked
            return {
                "action": "link",
                "record_type": "customer",
                "label": linked.full_name,
                "customer_id": linked.id,
                "fields": {},
                "warnings": [],
            }
        context.records["customer"] = True
        return {
            "action": "create",
            "record_type": "customer",
            "label": str(person.get("name") or "").strip(),
            "fields": {
                "name": str(person.get("name") or "").strip(),
                "email": normalize_customer_email(person.get("email")),
                "phone": str(person.get("phone") or "").strip(),
                "contact_information_needed": not bool(
                    normalize_customer_email(person.get("email"))
                    or normalize_customer_phone(person.get("phone"))
                ),
            },
            "warnings": self.find_conflicts(context),
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        linked = self._linked_customer(context)
        if linked:
            context.records["customer"] = linked
            context.linked_records.append({
                "type": "customer",
                "id": linked.id,
                "label": linked.full_name,
                "url": f"/app/customers/{linked.id}",
            })
            return linked
        person = self._person(context)
        warnings = self.find_conflicts(context)
        try:
            customer = Homeowner.objects.create(
                created_by=context.capture.contractor,
                full_name=str(person.get("name") or "").strip()[:255],
                email=normalize_customer_email(person.get("email")),
                phone_number=str(person.get("phone") or "").strip()[:20],
                origin_capture=context.capture,
            )
        except IntegrityError as exc:
            raise CaptureAdapterError(
                "A customer with this email already exists. Review the duplicate decision."
            ) from exc
        context.records["customer"] = customer
        context.created_records.append({
            "type": "customer",
            "id": customer.id,
            "label": customer.full_name,
            "url": f"/app/customers/{customer.id}",
        })
        context.warnings.extend(warnings)
        return customer
