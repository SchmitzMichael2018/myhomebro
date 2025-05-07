# projects/signals.py
from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import Agreement
from .utils import generate_agreement_pdf  # Assuming utils.py contains the generate_agreement_pdf function

@receiver(post_save, sender=Agreement)
def generate_agreement_pdf_on_creation(sender, instance, created, **kwargs):
    if created:  # Only generate the PDF when the agreement is first created
        generate_agreement_pdf(instance.id)
