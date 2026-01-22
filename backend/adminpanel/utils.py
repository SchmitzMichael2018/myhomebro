def safe_get(obj, field_names, default=None):
    """
    Try a list of possible field names on a model instance.
    Returns first that exists and is not None; else default.
    """
    for f in field_names:
        if hasattr(obj, f):
            val = getattr(obj, f)
            if val is not None:
                return val
    return default