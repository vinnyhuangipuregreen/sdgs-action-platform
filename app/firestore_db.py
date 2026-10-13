import os
import json
from typing import Optional, Dict, Any, List

def get_firestore_client():
    """
    Returns Google Cloud Firestore Client if credentials are provided.
    Compatible with:
    1. GOOGLE_APPLICATION_CREDENTIALS environment variable pointing to service-account.json
    2. FIRESTORE_PROJECT_ID environment variable
    """
    try:
        from google.cloud import firestore
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        project_id = os.environ.get("FIRESTORE_PROJECT_ID")
        
        if cred_path and os.path.exists(cred_path):
            return firestore.Client.from_service_account_json(cred_path)
        elif project_id:
            return firestore.Client(project=project_id)
        else:
            # Default auto-discovery
            return firestore.Client()
    except Exception as e:
        return None

def is_firestore_enabled() -> bool:
    return get_firestore_client() is not None
