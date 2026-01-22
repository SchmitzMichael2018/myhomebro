# backend/backend/receipts/admin_urls.py

from django.urls import path

from receipts.admin_fee_ledger import admin_fee_ledger

urlpatterns = [
    path("fees/ledger/", admin_fee_ledger, name="admin_fee_ledger"),
]
