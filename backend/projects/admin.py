from django.contrib import admin
from .models import Project, Agreement, Invoice, Contractor

admin.site.register(Project)
admin.site.register(Agreement)
admin.site.register(Invoice)
admin.site.register(Contractor)
