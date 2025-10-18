# TEMPORARY forwarder so legacy imports keep working during the transition.
# Old code:   from payments.stripe_config import stripe
# New path:   from payments.stripe_config import stripe
from payments.stripe_config import stripe  # noqa: F401
