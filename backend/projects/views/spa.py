# backend/projects/views/spa.py
from pathlib import Path
from django.http import HttpResponse, HttpResponseNotFound
from django.views import View
from django.conf import settings

class SPAIndexView(View):
    """
    Always serve the latest React build HTML from frontend/dist/index.html.
    This avoids stale hashed bundles and lets Vite control the asset URLs.
    """
    def get(self, request, *args, **kwargs):
        index_path = Path(settings.BASE_DIR) / "frontend" / "dist" / "index.html"
        try:
            html = index_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return HttpResponseNotFound("Build not found. Run `npm run build` in /frontend.")
        return HttpResponse(html)
