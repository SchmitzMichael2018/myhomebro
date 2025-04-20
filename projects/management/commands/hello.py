from django.core.management.base import BaseCommand

class Command(BaseCommand):
    help = 'Test if custom management commands are loaded'

    def handle(self, *args, **kwargs):
        self.stdout.write(self.style.SUCCESS('✅ Hello from custom command!'))
