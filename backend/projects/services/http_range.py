# backend/projects/services/http_range.py
from __future__ import annotations

import os
import re
from typing import Optional, Tuple

from django.http import FileResponse, HttpResponse
from django.utils.http import http_date


_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


def _parse_range(range_header: str, file_size: int) -> Optional[Tuple[int, int]]:
    """
    Returns (start, end) inclusive, or None if invalid.
    Supports: bytes=START-END, bytes=START-, bytes=-SUFFIX
    """
    m = _RANGE_RE.match((range_header or "").strip())
    if not m:
        return None

    start_s, end_s = m.group(1), m.group(2)

    # bytes=-SUFFIX (last SUFFIX bytes)
    if start_s == "" and end_s:
        suffix = int(end_s)
        if suffix <= 0:
            return None
        start = max(0, file_size - suffix)
        end = file_size - 1
        return (start, end)

    # bytes=START- or bytes=START-END
    if start_s:
        start = int(start_s)
        if start >= file_size or start < 0:
            return None

        if end_s:
            end = int(end_s)
            end = min(end, file_size - 1)
            if end < start:
                return None
        else:
            end = file_size - 1

        return (start, end)

    return None


def ranged_file_response(
    request,
    path: str,
    content_type: str = "application/pdf",
    filename: Optional[str] = None,
    inline: bool = True,
) -> HttpResponse:
    """
    File response with HTTP Range support (needed for iOS/Safari multi-page PDFs).
    """
    file_size = os.path.getsize(path)
    range_header = request.META.get("HTTP_RANGE", "")

    # Common headers
    disposition = "inline" if inline else "attachment"
    out_name = filename or os.path.basename(path)

    # No Range: normal full response
    if not range_header:
        resp = FileResponse(open(path, "rb"), content_type=content_type)
        resp["Content-Length"] = str(file_size)
        resp["Accept-Ranges"] = "bytes"
        resp["Content-Disposition"] = f'{disposition}; filename="{out_name}"'
        resp["Last-Modified"] = http_date(os.path.getmtime(path))
        return resp

    # Range requested
    parsed = _parse_range(range_header, file_size)
    if not parsed:
        # Invalid range → 416
        resp = HttpResponse(status=416)
        resp["Content-Range"] = f"bytes */{file_size}"
        resp["Accept-Ranges"] = "bytes"
        return resp

    start, end = parsed
    length = (end - start) + 1

    f = open(path, "rb")
    f.seek(start)

    resp = FileResponse(f, status=206, content_type=content_type)
    resp["Content-Length"] = str(length)
    resp["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    resp["Accept-Ranges"] = "bytes"
    resp["Content-Disposition"] = f'{disposition}; filename="{out_name}"'
    resp["Last-Modified"] = http_date(os.path.getmtime(path))
    return resp
