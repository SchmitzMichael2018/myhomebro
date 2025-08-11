# projects/views/contractors/public.py

from rest_framework.generics import RetrieveAPIView
from rest_framework.permissions import AllowAny
from projects.models import Contractor
from projects.serializers import PublicContractorSerializer

class ContractorPublicProfileView(RetrieveAPIView):
    queryset = Contractor.objects.all()
    serializer_class = PublicContractorSerializer
    permission_classes = [AllowAny]
    lookup_field = "pk"
