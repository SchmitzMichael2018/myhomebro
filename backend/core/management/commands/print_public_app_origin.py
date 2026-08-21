from django.core.management.base import BaseCommand

from core.public_app_urls import public_app_origin


class Command(BaseCommand):
    help = "Print only the resolved authoritative public application origin."

    def handle(self, *args, **options):
        self.stdout.write(public_app_origin())
