from django.core.management.base import BaseCommand
from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone


class Command(BaseCommand):
    help = "Seed default MyHomeBro project templates"

    def handle(self, *args, **kwargs):

        templates = [

            {
                "name": "Standard Kitchen Remodel",
                "project_type": "Remodel",
                "estimated_days": 10,
                "milestones": [
                    "Demo & Prep",
                    "Rough Electrical & Plumbing",
                    "Cabinet & Fixture Install",
                    "Finishing Work",
                    "Final Walkthrough"
                ]
            },

            {
                "name": "Bathroom Remodel",
                "project_type": "Remodel",
                "estimated_days": 7,
                "milestones": [
                    "Demolition",
                    "Plumbing & Electrical Prep",
                    "Tile & Shower Install",
                    "Fixture Install",
                    "Final Cleanup"
                ]
            },

            {
                "name": "General Repair Job",
                "project_type": "Repair",
                "estimated_days": 2,
                "milestones": [
                    "Inspection & Diagnosis",
                    "Repair Work",
                    "Testing & Completion"
                ]
            },

            {
                "name": "Flooring Installation",
                "project_type": "Installation",
                "estimated_days": 3,
                "milestones": [
                    "Prep & Leveling",
                    "Install Flooring",
                    "Trim & Cleanup"
                ]
            },

            {
                "name": "Interior Painting",
                "project_type": "Painting",
                "estimated_days": 2,
                "milestones": [
                    "Prep & Masking",
                    "Paint Application",
                    "Cleanup & Inspection"
                ]
            },

            {
                "name": "Deck Construction",
                "project_type": "Outdoor",
                "estimated_days": 5,
                "milestones": [
                    "Site Prep",
                    "Foundation & Framing",
                    "Deck Boards Install",
                    "Railing Install",
                    "Final Inspection"
                ]
            },

            {
                "name": "Home Inspection Service",
                "project_type": "Inspection",
                "estimated_days": 1,
                "milestones": [
                    "On-Site Inspection",
                    "Documentation",
                    "Report Delivery"
                ]
            },

            {
                "name": "DIY Contractor Assist",
                "project_type": "DIY Help",
                "estimated_days": 1,
                "milestones": [
                    "Project Review",
                    "Hands-On Assistance",
                    "Wrap-Up Guidance"
                ]
            },

        ]

        created_count = 0

        for tpl in templates:

            template, created = ProjectTemplate.objects.get_or_create(
                name=tpl["name"],
                defaults={
                    "project_type": tpl["project_type"],
                    "description": tpl["name"],
                    "estimated_days": tpl["estimated_days"],
                    "is_system": True,
                    "is_active": True,
                },
            )

            if not created:
                continue

            for idx, milestone in enumerate(tpl["milestones"], start=1):
                ProjectTemplateMilestone.objects.create(
                    template=template,
                    title=milestone,
                    sort_order=idx,
                )

            created_count += 1

        self.stdout.write(
            self.style.SUCCESS(f"Seeded {created_count} project templates.")
        )