# projects/admin.py

from django.contrib import admin
from .models import (
    Homeowner,
    Contractor,
    Project,
    Agreement,
    Milestone,
    Invoice,
)

@admin.register(Homeowner)
class HomeownerAdmin(admin.ModelAdmin):
    # --- FIX: Updated list_display and search_fields to use the new field names ---
    list_display = ('id', 'full_name', 'email', 'phone_number', 'status', 'created_at')
    search_fields = ('full_name', 'email', 'phone_number')
    list_filter = ('status', 'created_at',)

@admin.register(Contractor)
class ContractorAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'email', 'phone', 'business_name', 'created_at')
    search_fields = ('user__first_name', 'user__last_name', 'user__email', 'business_name')
    list_filter = ('created_at',)

@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('id', 'number', 'title', 'status', 'created_at')
    search_fields = ('number', 'title')
    list_filter = ('status', 'created_at',)

@admin.register(Agreement)
class AgreementAdmin(admin.ModelAdmin):
    list_display = ('id', 'project', 'contractor', 'total_cost', 'escrow_funded', 'created_at')
    search_fields = ('project__number', 'project__title', 'contractor__user__email')
    list_filter = ('escrow_funded', 'created_at',)

@admin.register(Milestone)
class MilestoneAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'agreement',
        'order',
        'title',
        'amount',
        'start_date',
        'completion_date',
        'is_invoiced',
        'completed',
    )
    search_fields = ('title',)
    list_filter = ('is_invoiced', 'completed',)

@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'invoice_number',
        'agreement',
        'amount',
        'status',
        'created_at',
    )
    search_fields = ('invoice_number', 'agreement__project__number')
    list_filter = ('status', 'created_at')
    ordering = ('-created_at',)