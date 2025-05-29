#!/usr/bin/env python
"""
Django Management Utility (Enhanced)

- Provides command-line management of the Django project.
- Secure error handling and debug logging for better control.
- Automatically detects and logs active settings module (in debug mode).
"""

import os
import sys
import logging

logger = logging.getLogger(__name__)

def main():
    """Run administrative tasks with enhanced error handling."""
    try:
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
        if os.environ.get('DEBUG', 'False').lower() == 'true':
            logger.info(f"✅ Using Settings Module: {os.environ.get('DJANGO_SETTINGS_MODULE')}")
    except Exception as e:
        logger.error("❌ Environment Initialization Error: %s", str(e))
        if os.environ.get('DEBUG', 'False').lower() == 'true':
            sys.exit(1)
        else:
            raise RuntimeError("Environment Initialization Error")
    
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        logger.error("❌ Django Import Error: %s", str(exc))
        if os.environ.get('DEBUG', 'False').lower() == 'true':
            print("❌ Django Import Error: Make sure Django is installed and your virtual environment is activated.")
            sys.exit(1)
        else:
            raise ImportError("Django Import Error: Make sure Django is installed and your virtual environment is activated.") from exc
    
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()


