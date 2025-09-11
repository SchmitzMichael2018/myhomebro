from rest_framework.pagination import PageNumberPagination

class DefaultPageNumberPagination(PageNumberPagination):
    """
    Default API pagination:
      - 20 per page
      - client can request ?page_size=... up to 100
    Response:
      { "count": n, "next": url|null, "previous": url|null, "results": [...] }
    """
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100
