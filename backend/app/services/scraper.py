from __future__ import annotations
import re
import time
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

SKIP_DOMAINS = {
    "instagram.com", "facebook.com", "fb.com", "tiktok.com",
    "twitter.com", "x.com", "youtube.com", "linkedin.com",
    "pinterest.com", "reddit.com", "mercadolibre.com.ar",
}

NON_AR_PHONE_PREFIXES = (
    "+1 ", "+1-", "+1.", "+1(",
    "+34", "+44", "+33", "+39", "+49", "+351", "+31", "+32", "+41",
    "+55", "+56", "+57", "+58", "+51", "+52", "+591", "+593", "+595", "+598",
    "+86", "+81", "+82", "+886", "+852", "+91", "+62", "+65", "+66", "+971",
)

NON_AR_TLDS = {
    "tw", "cn", "jp", "kr", "br", "cl", "uy", "py", "bo", "pe", "co", "ve",
    "ec", "mx", "es", "pt", "it", "fr", "de", "uk", "us", "ca", "au",
}

COUNTRY_KEYWORDS_NON_AR_UPPER = (
    "TAIWAN", "TAIWÁN", "JAPAN", "KOREA", "HONG KONG", "SINGAPORE",
    "UNITED STATES", "U.S.A.", "ESTADOS UNIDOS",
    "BRAZIL", "BRASIL", "URUGUAY", "PARAGUAY", "BOLIVIA",
    "CHILE", "COLOMBIA", "VENEZUELA", "ECUADOR",
    "MEXICO", "MÉXICO", "PERU", "PERÚ",
    "SPAIN", "ESPAÑA", "PORTUGAL", "ITALY", "ITALIA",
    "FRANCE", "FRANCE", "GERMANY", "ALEMANIA", "UK", "ENGLAND",
)

FAKE_EMAILS = {
    "info@example.com", "email@example.com", "test@test.com",
    "noreply@noreply.com", "no-reply@no-reply.com",
    "tunombre@", "tu-email@", "youremail@",
}


def normalize_phone(phone: str, mobile: bool = True) -> str:
    digits = re.sub(r'\D', '', phone)
    if digits.startswith('54'):
        digits = digits[2:]
    if digits.startswith('9'):
        digits = digits[1:]
    if digits.startswith('0'):
        digits = digits[1:]
    if len(digits) == 12:
        for pos_area in (2, 3, 4):
            if digits[pos_area:pos_area+2] == '15':
                cand = digits[:pos_area] + digits[pos_area+2:]
                if len(cand) == 10:
                    digits = cand
                    break
    if len(digits) < 10 or len(digits) > 11:
        return ""
    return f"+54 9 {digits}" if mobile else f"+54 {digits}"


def phone_key(phone: str) -> str:
    digits = re.sub(r'\D', '', phone)
    return digits[-10:] if len(digits) >= 10 else digits


def get_host(url: str) -> str:
    if not url:
        return ""
    try:
        u = url if url.startswith("http") else "http://" + url
        host = urlparse(u).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return ""


def get_company_name(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return host.split('.')[0]
    except Exception:
        return ""


def is_useful_domain(url: str) -> bool:
    try:
        host = urlparse(url).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        for skip in SKIP_DOMAINS:
            if host == skip or host.endswith("." + skip):
                return False
        return True
    except Exception:
        return False


def detect_non_ar_signal(html: str, url: str) -> str:
    try:
        tld = urlparse(url).netloc.rsplit('.', 1)[-1].lower()
        if tld in NON_AR_TLDS:
            return f"TLD .{tld}"
    except Exception:
        pass
    for prefix in NON_AR_PHONE_PREFIXES:
        if prefix in html:
            return f"phone prefix {prefix.strip()}"
    for kw in COUNTRY_KEYWORDS_NON_AR_UPPER:
        if kw in html:
            return f"keyword {kw}"
    return ""


def _decode_cloudflare_email(encoded: str) -> str:
    try:
        r = int(encoded[:2], 16)
        return "".join(
            chr(int(encoded[i:i+2], 16) ^ r)
            for i in range(2, len(encoded), 2)
        )
    except Exception:
        return ""


def _extract_contacts(soup, html: str) -> tuple[list, list, list]:
    emails = []
    phones = []
    whatsapps = []

    # Cloudflare obfuscated emails
    for el in soup.select("a[data-cfemail]"):
        decoded = _decode_cloudflare_email(el.get("data-cfemail", ""))
        if decoded and "@" in decoded:
            emails.append(decoded)

    # Plain emails
    raw_emails = re.findall(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', html)
    for e in raw_emails:
        if e not in emails and not any(fake in e for fake in FAKE_EMAILS):
            emails.append(e)

    # WhatsApp links
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "wa.me/" in href or "api.whatsapp.com/send" in href:
            m = re.search(r'(\d{10,15})', href)
            if m:
                wa = normalize_phone(m.group(1))
                if wa:
                    whatsapps.append(wa)

    # Phones in text
    raw_phones = re.findall(r'(?<!\d)(?:\+54[\s\-]?)?(?:9[\s\-]?)?(?:11|[2-9]\d)[\s\-]?\d{4}[\s\-]?\d{4}(?!\d)', html)
    for p in raw_phones:
        norm = normalize_phone(p, mobile=False)
        if norm and norm not in phones:
            phones.append(norm)

    return emails[:3], phones[:3], whatsapps[:2]


def _find_contact_url(soup, base_url: str) -> str | None:
    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True).lower()
        href = a["href"]
        if any(kw in text or kw in href.lower() for kw in ("contacto", "contact", "contactanos")):
            if href.startswith("http"):
                return href
            if href.startswith("/"):
                parsed = urlparse(base_url)
                return f"{parsed.scheme}://{parsed.netloc}{href}"
    return None


def _extract_clasificacion_text(soup) -> str:
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    text = soup.get_text(separator=" ", strip=True)
    return " ".join(text.split())[:1000]


def _extract_address_block(soup) -> str:
    for el in soup.find_all(string=re.compile(r'\b(calle|av\.|avda\.|dirección|address)\b', re.I)):
        parent = el.parent
        if parent:
            text = parent.get_text(strip=True)
            if len(text) < 200:
                return text
    return ""


def scrape_page(url: str) -> dict:
    try:
        r = requests.get(url, timeout=12, headers=BROWSER_HEADERS)
        soup = BeautifulSoup(r.text, "html.parser")
        html_full = r.text

        emails, phones, whatsapps = _extract_contacts(soup, r.text)

        if not emails and not phones and not whatsapps:
            contact_url = _find_contact_url(soup, url)
            if contact_url:
                try:
                    r2 = requests.get(contact_url, timeout=12, headers=BROWSER_HEADERS)
                    soup2 = BeautifulSoup(r2.text, "html.parser")
                    emails, phones, whatsapps = _extract_contacts(soup2, r2.text)
                    html_full = html_full + "\n" + r2.text
                except Exception:
                    pass

        texto_clasif = _extract_clasificacion_text(soup)
        direccion = _extract_address_block(soup)
        pais_no_ar = detect_non_ar_signal(html_full, url)

        return {
            "nombre":              get_company_name(url),
            "url":                 url,
            "email":               emails[0] if emails else "",
            "telefono":            phones[0] if phones else "",
            "whatsapp":            whatsapps[0] if whatsapps else "",
            "texto_clasificacion": texto_clasif,
            "direccion":           direccion,
            "pais_no_ar":          pais_no_ar,
        }
    except Exception:
        return {
            "nombre": get_company_name(url), "url": url,
            "email": "", "telefono": "", "whatsapp": "",
            "texto_clasificacion": "", "direccion": "", "pais_no_ar": "",
        }


def run_scraper(termino_id: int):
    """Corre en un thread daemon. Lee config del tenant desde la DB,
    scrapea Google via Apify, clasifica con Haiku y guarda en PostgreSQL."""
    from app.database import SessionLocal
    from app.models.prospect import Prospect
    from app.models.termino import Termino
    from app.models.tenant import TenantConfig
    from app.models.rubro import Rubro
    from app.services import apify as apify_svc
    from app.services import classify as classify_svc

    db = SessionLocal()
    try:
        termino = db.get(Termino, termino_id)
        if not termino:
            return

        config = db.query(TenantConfig).filter(TenantConfig.tenant_id == termino.tenant_id).first()
        apify_token = config.apify_token if config else ""
        anthropic_key = config.anthropic_api_key if config else ""
        pais_tenant = (config.pais if config else None) or "Argentina"
        excl_tenant = (config.clasif_exclusiones if config else None) or None

        rubros_db = db.query(Rubro).filter(Rubro.tenant_id == termino.tenant_id).all()
        rubros_nombres = [r.nombre for r in rubros_db]
        rubro_map = {r.nombre: r.id for r in rubros_db}

        # URLs y hosts ya cargados (para dedup)
        existing = db.query(Prospect.url).filter(Prospect.tenant_id == termino.tenant_id).all()
        existing_urls = {row[0] for row in existing if row[0]}
        existing_hosts = {get_host(u) for u in existing_urls if get_host(u)}

        try:
            urls = apify_svc.google_search(termino.texto, apify_token)
        except Exception as e:
            print(f"[SCRAPER] Error Apify: {e}")
            return

        total = 0
        for url in urls:
            if not is_useful_domain(url):
                continue
            if url in existing_urls:
                continue
            host = get_host(url)
            if host and host in existing_hosts:
                continue

            result = scrape_page(url)

            if result.get("pais_no_ar"):
                if host:
                    existing_hosts.add(host)
                continue

            tld = ""
            if host:
                tld_last = host.rsplit('.', 1)[-1]
                if tld_last and tld_last != "ar":
                    tld = tld_last

            try:
                rubro_nombre = classify_svc.clasificar(
                    nombre_empresa=result.get("nombre", ""),
                    texto_pagina=result.get("texto_clasificacion", ""),
                    rubros_validos=rubros_nombres,
                    anthropic_api_key=anthropic_key,
                    direccion=result.get("direccion", ""),
                    tld=tld,
                    pais=pais_tenant,
                    exclusiones=excl_tenant,
                )
            except Exception as e:
                print(f"[SCRAPER] Error clasificando {url}: {e}")
                rubro_nombre = rubros_nombres[0] if rubros_nombres else None

            # Si hay rubros configurados y el resultado es "no_aplica", saltear
            if rubro_nombre == "no_aplica":
                if host:
                    existing_hosts.add(host)
                continue

            # Verificar WhatsApp
            wa = result.get("whatsapp", "").strip()
            if wa and apify_token:
                has_wa = apify_svc.check_whatsapp(wa, apify_token)
                if has_wa is False:
                    result["whatsapp"] = ""

            rubro_id = rubro_map.get(rubro_nombre) if rubro_nombre else None

            prospect = Prospect(
                tenant_id=termino.tenant_id,
                termino_id=termino_id,
                rubro_id=rubro_id,
                nombre=result.get("nombre", get_company_name(url)),
                url=url,
                email=result.get("email") or None,
                telefono=result.get("telefono") or None,
                whatsapp=result.get("whatsapp") or None,
                estado="sin_contactar",
                id_scraper=str(termino_id),
            )
            db.add(prospect)
            existing_urls.add(url)
            if host:
                existing_hosts.add(host)
            total += 1
            db.commit()

            time.sleep(0.5)

        termino.encontrados = (termino.encontrados or 0) + total
        termino.scraper_running = False
        db.commit()
        print(f"[SCRAPER] '{termino.texto}' → {total} prospects cargados")

    except Exception as e:
        print(f"[SCRAPER ERROR] {e}")
        try:
            if termino:
                termino.scraper_running = False
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
