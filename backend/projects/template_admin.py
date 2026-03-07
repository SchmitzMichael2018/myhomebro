from django.contrib import admin

from projects.template_models import ProjectTemplate, ProjectTemplateMilestone


class ProjectTemplateMilestoneInline(admin.TabularInline):
    model = ProjectTemplateMilestone
    extra = 1
    fields = (
        "sort_order",
        "title",
        "description",
        "recommended_days_from_start",
        "recommended_duration_days",
        "suggested_amount_percent",
        "suggested_amount_fixed",
        "materials_hint",
        "is_optional",
    )


@admin.register(ProjectTemplate)
class ProjectTemplateAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "project_type",
        "project_subtype",
        "is_system",
        "contractor",
        "is_active",
        "estimated_days",
        "created_at",
    )
    list_filter = ("is_system", "is_active", "project_type", "project_subtype")
    search_fields = ("name", "project_type", "project_subtype", "description")
    inlines = [ProjectTemplateMilestoneInline]


@admin.register(ProjectTemplateMilestone)
class ProjectTemplateMilestoneAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "template",
        "sort_order",
        "title",
        "suggested_amount_percent",
        "suggested_amount_fixed",
        "is_optional",
    )
    list_filter = ("is_optional", "template__project_type")
    search_fields = ("title", "description", "materials_hint", "template__name")