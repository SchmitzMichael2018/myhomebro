from .customer import CustomerAdapter
from .customer_note import CustomerNoteAdapter
from .follow_up import FollowUpAdapter
from .opportunity import OpportunityAdapter
from .unassigned_note import UnassignedNoteAdapter

ADAPTERS = {
    "customer": CustomerAdapter(),
    "opportunity": OpportunityAdapter(),
    "follow_up": FollowUpAdapter(),
    "customer_note": CustomerNoteAdapter(),
    "unassigned_note": UnassignedNoteAdapter(),
}

