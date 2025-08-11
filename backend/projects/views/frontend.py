from django.views import View
from django.http import FileResponse, HttpResponse
from django.conf import settings
from pathlib import Path

class StaticIndexView(View):
    def get(self, request):
        # Point to frontend/dist/index.html relative to BASE_DIR
        index_path = Path(settings.BASE_DIR).parent / "frontend" / "dist" / "index.html"

        if index_path.exists():
            return FileResponse(open(index_path, 'rb'))
        
        return HttpResponse(
            f"Frontend build not found at: {index_path}",
            status=404
        )
