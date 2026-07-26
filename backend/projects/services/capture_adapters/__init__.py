from .customer import CustomerAdapter
from .customer_note import CustomerNoteAdapter
from .follow_up import FollowUpAdapter
from .opportunity import OpportunityAdapter
from .unassigned_note import UnassignedNoteAdapter
from .communication_log import CommunicationLogAdapter
from .project_activity import ProjectActivityAdapter
from .project_attachment import ProjectAttachmentAdapter
from .project_issue import ProjectIssueAdapter
from .project_note import ProjectNoteAdapter

ADAPTERS = {
    "customer": CustomerAdapter(),
    "opportunity": OpportunityAdapter(),
    "follow_up": FollowUpAdapter(),
    "customer_note": CustomerNoteAdapter(),
    "unassigned_note": UnassignedNoteAdapter(),
    "project_note": ProjectNoteAdapter(),
    "project_activity": ProjectActivityAdapter(),
    "project_attachment": ProjectAttachmentAdapter(),
    "project_issue": ProjectIssueAdapter(),
    "communication_log": CommunicationLogAdapter(),
}
