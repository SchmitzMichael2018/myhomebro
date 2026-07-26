from projects.services.capture_permissions import (
    _active_subaccount,
    _is_owner,
    _is_supervisor,
    can_create_project_capture,
)
from projects.utils.accounts import get_contractor_for_user


def takeoff_capabilities(user, project=None):
    contractor = get_contractor_for_user(user) if user and user.is_authenticated else None
    owns_project = bool(contractor and project and project.contractor_id == contractor.id)
    pricing_manager = bool(contractor and (_is_owner(user) or _is_supervisor(user)))
    assigned_field = bool(owns_project and can_create_project_capture(user, project))
    return {
        "view": pricing_manager or assigned_field,
        "create_provisional": pricing_manager or assigned_field,
        "manage_pricing": pricing_manager,
        "confirm": pricing_manager,
        "estimate_handoff": pricing_manager,
        "contractor": contractor,
        "subaccount": _active_subaccount(user),
    }
