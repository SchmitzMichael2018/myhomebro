"""
projects.serializers package initializer.

We re-export commonly used serializers from our submodules so existing imports like:
    from projects.serializers import AgreementWriteSerializer
continue to work.

Modules:
- base: everything except Dispute serializers
- dispute: Dispute + DisputeAttachment serializers

If you add new serializer modules, import and extend __all__ here.
"""

from .base import *  # re-export non-dispute serializers
from .dispute import *  # re-export dispute serializers

__all__ = []  # populated by star imports above
