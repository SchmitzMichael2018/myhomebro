# backend/projects/permissions/attachments.py
from rest_framework.permissions import BasePermission, SAFE_METHODS
from projects.models import Agreement
from projects.models_attachments import AgreementAttachment


class IsAgreementParticipantOrAdmin(BasePermission):
    """
    Superuser override ONLY (no staff bypass).

    Participants:
      - agreement.contractor.user  (or request.user.contractor == agreement.contractor)
      - agreement.homeowner.user   (only if your schema links it)
      - attachment.uploaded_by     (uploader)

    Policies:
      - Flat collection list/create require ?agreement=<id> AND participant.
      - Detail actions (retrieve/update/destroy) rely on object-level checks.
      - DELETE: allowed for superuser always; OR contractor/uploader while NOT fully signed.
      - PATCH/PUT: contractor only (superuser always).
      - SAFE (GET/HEAD/OPTIONS): any participant (contractor/homeowner/uploader).
    """

    # ---- helpers ----
    def _get_agreement_from_view(self, request, view):
        agreement_id = (
            getattr(view, "kwargs", {}).get("agreement_id")
            or getattr(view, "kwargs", {}).get("agreement_pk")
            or request.query_params.get("agreement")
        )
        if not agreement_id:
            return None
        try:
            return Agreement.objects.select_related("contractor", "homeowner").get(pk=agreement_id)
        except Agreement.DoesNotExist:
            return None

    def _user_is_contractor_for(self, user, agreement: Agreement) -> bool:
        if not user or not user.is_authenticated or not agreement:
            return False
        # A) compare via contractor.user_id
        if getattr(getattr(agreement, "contractor", None), "user_id", None) == user.id:
            return True
        # B) compare via user's Contractor profile (OneToOne)
        return getattr(getattr(user, "contractor", None), "id", None) == getattr(agreement, "contractor_id", None)

    def _user_is_homeowner_for(self, user, agreement: Agreement) -> bool:
        # Only True if your Homeowner links to auth.User
        return getattr(getattr(agreement, "homeowner", None), "user_id", None) == getattr(user, "id", None)

    def _user_is_uploader(self, user, attachment: AgreementAttachment) -> bool:
        return getattr(attachment, "uploaded_by_id", None) == getattr(user, "id", None)

    def _is_fully_signed(self, agreement: Agreement) -> bool:
        return bool(getattr(agreement, "signed_by_contractor", False) and getattr(agreement, "signed_by_homeowner", False))

    # ---- DRF hooks ----
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:                     # OWNER override only
            return True

        action = getattr(view, "action", None)

        # Flat collection: list/create require ?agreement=<id> & participant
        if action in {"list", "create"}:
            ag = self._get_agreement_from_view(request, view)
            if not ag:
                return False
            return self._user_is_contractor_for(user, ag) or self._user_is_homeowner_for(user, ag)

        # Detail actions defer to object-level checks
        return True

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True

        if isinstance(obj, AgreementAttachment):
            ag = obj.agreement
            is_uploader = self._user_is_uploader(user, obj)
        elif isinstance(obj, Agreement):
            ag = obj
            is_uploader = False
        else:
            ag = self._get_agreement_from_view(request, view)
            is_uploader = False

        if not ag:
            return False

        is_contractor = self._user_is_contractor_for(user, ag)
        is_homeowner  = self._user_is_homeowner_for(user, ag)  # may be False if not linked
        is_participant = is_contractor or is_homeowner or is_uploader

        if request.method in SAFE_METHODS:
            return is_participant

        # DELETE: contractor or uploader may delete while NOT fully signed
        if request.method == "DELETE":
            if self._is_fully_signed(ag):
                return False
            return is_contractor or is_uploader

        # PATCH/PUT: contractor only (homeowner/uploader cannot)
        return is_contractor
