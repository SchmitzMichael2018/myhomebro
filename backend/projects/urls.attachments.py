# backend/projects/urls_attachments.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from projects.views.attachments import AttachmentViewSet, AgreementAttachmentNestedView

router = DefaultRouter()
router.register(r'attachments', AttachmentViewSet, basename='attachment')

urlpatterns = [
    # Flat router: /api/projects/attachments/
    path('', include(router.urls)),

    # Nested: /api/projects/agreements/<agreement_id>/attachments/
    path(
        'agreements/<int:agreement_id>/attachments/',
        AgreementAttachmentNestedView.as_view({'get': 'list', 'post': 'create'}),
        name='agreement-attachments',
    ),
]
