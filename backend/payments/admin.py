# ~/backend/backend/payments/admin.py
from django.contrib import admin
from .models import ConnectedAccount


@admin.register(ConnectedAccount)
class ConnectedAccountAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "stripe_account_id",
        "charges_enabled",
        "payouts_enabled",
        "details_submitted",
        "updated_at",
    )
    list_filter = ("charges_enabled", "payouts_enabled", "details_submitted")
    search_fields = ("user__email", "stripe_account_id")
    readonly_fields = ("created_at", "updated_at")
