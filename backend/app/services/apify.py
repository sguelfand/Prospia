from __future__ import annotations
import requests

APIFY_ACTOR_URL   = "https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items"
APIFY_WA_CHECK_URL = "https://api.apify.com/v2/acts/api_factory~whatsapp-number-validator/run-sync-get-dataset-items"

RESULTS_PER_TERM = 30


def google_search(termino: str, apify_token: str, num_results: int = RESULTS_PER_TERM) -> list[str]:
    payload = {
        "queries":          termino,
        "resultsPerPage":   10,
        "maxPagesPerQuery": max(1, (num_results + 9) // 10),
        "languageCode":     "es",
        "countryCode":      "ar",
    }
    r = requests.post(
        APIFY_ACTOR_URL,
        params={"token": apify_token},
        json=payload,
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    urls = []
    if isinstance(data, list):
        for entry in data:
            for item in entry.get("organicResults", []):
                if item.get("url"):
                    urls.append(item["url"])
    return urls


def _check_whatsapp_single(numero: str, apify_token: str) -> "bool | None":
    try:
        r = requests.post(
            APIFY_WA_CHECK_URL,
            params={"token": apify_token},
            json={"phone_number": numero},
            timeout=20,
        )
    except Exception as e:
        print(f"[WA CHECK] {type(e).__name__} para {numero}: {e}")
        return None
    if r.status_code not in (200, 201):
        return None
    try:
        data = r.json()
    except Exception:
        return None
    if isinstance(data, list) and data and "hasWhatsapp" in data[0]:
        return bool(data[0]["hasWhatsapp"])
    return None


def check_whatsapp(numero: str, apify_token: str) -> "bool | None":
    """Verifica si un número tiene WhatsApp. Prueba dos variantes para números
    argentinos (con/sin '9' móvil) para evitar falsos negativos."""
    if not numero or not apify_token:
        return None

    from app.services.scraper import normalize_phone
    normalized = normalize_phone(numero)
    if not normalized:
        return _check_whatsapp_single(numero, apify_token)

    # Variante 1: con '9' móvil (+54 9 XXXXXXXXXX)
    result1 = _check_whatsapp_single(normalized, apify_token)
    if result1 is True:
        return True

    # Variante 2: sin '9' (+54 XXXXXXXXXX)
    alt = normalized.replace("+54 9 ", "+54 ", 1)
    result2 = _check_whatsapp_single(alt, apify_token)
    if result2 is True:
        return True

    if result1 is False and result2 is False:
        return False
    return None
