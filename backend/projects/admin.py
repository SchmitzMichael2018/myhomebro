from django.contrib import admin
from .models import (
    Homeowner, Contractor, Project, Agreement,
    Milestone, Invoice, Message
)

@admin.register(Homeowner)
class HomeownerAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'email', 'created_at')
    search_fields = ('name', 'email')
    list_filter = ('created_at',)

@admin.register(Contractor)
class ContractorAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'email', 'phone', 'business_name', 'created_at')
    search_fields = ('name', 'email', 'business_name')
    list_filter = ('created_at',)

@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('id', 'number', 'title', 'status', 'created_at')
    search_fields = ('number', 'title')
    list_filter = ('status', 'created_at')

@admin.register(Agreement)
class AgreementAdmin(admin.ModelAdmin):
    list_display = ('id', 'project', 'contractor', 'total_cost', 'escrow_funded', 'created_at')
    search_fields = ('project__number', 'project__title', 'contractor__name')
    list_filter = ('escrow_funded', 'created_at')

@admin.register(Milestone)
class MilestoneAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'agreement', 'order', 'title', 'amount',
        'start_date', 'completion_date', 'is_invoiced', 'completed'
    )
    search_fields = ('title',)
    list_filter = ('is_invoiced', 'completed')

@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ('id', 'agreement', 'amount_due', 'due_date', 'status', 'created_at')
    search_fields = ('agreement__project__number',)
    list_filter = ('status', 'due_date')

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'agreement', 'sender', 'created_at')
    search_fields = ('sender__username',)
    list_filter = ('created_at',)



