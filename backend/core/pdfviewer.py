from django.http import FileResponse, Http404
from django.views.decorators.clickjacking import xframe_options_exempt
from django.contrib.staticfiles import finders

@xframe_options_exempt
def viewer(request):
    """
    Serves the PDF.js viewer with frame exemption so it can render inside your modal.
    URL: /pdf/viewer/?file=<encoded PDF URL>
    """
    path = finders.find("pdfjs/web/viewer.html")
    if not path:
        raise Http404("pdfjs viewer not found. Did you copy pdfjs to static and run collectstatic?")
    resp = FileResponse(open(path, "rb"), content_type="text/html; charset=utf-8")
    resp["X-Frame-Options"] = "SAMEORIGIN"  # belt + suspenders
    return resp
