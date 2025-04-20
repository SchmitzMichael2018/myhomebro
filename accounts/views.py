from django.shortcuts import render
from rest_framework import viewsets
from projects.serializers import ContractorSerializer
from projects.models import Contractor


class ContractorViewSet(viewsets.ModelViewSet):
    queryset = Contractor.objects.all()
    serializer_class = ContractorSerializer

# Create your views here.
