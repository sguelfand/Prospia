import re

import requests

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL   = "claude-haiku-4-5-20251001"


# Exclusiones por defecto si el tenant no configuró las suyas
EXCLUSIONES_DEFAULT = [
    "supermercado", "retailer", "e-commerce que solo revende",
    "blog", "media", "agencia", "consultora", "competencia directa",
]


def clasificar(
    nombre_empresa: str,
    texto_pagina: str,
    rubros_validos: list[str],
    anthropic_api_key: str,
    direccion: str = "",
    tld: str = "",
    pais: str = "Argentina",
    exclusiones: list[str] | None = None,
) -> str:
    """Clasifica una empresa en uno de los rubros configurados por el tenant,
    más 'no_aplica' si no corresponde a ninguno. Retorna el nombre del rubro
    o 'no_aplica'. Si falla, retorna el primer rubro o 'no_aplica'.

    `pais` y `exclusiones` vienen de la config del tenant (clasif_exclusiones)."""
    if not anthropic_api_key or not texto_pagina.strip():
        return rubros_validos[0] if rubros_validos else "no_aplica"

    excl = list(exclusiones) if exclusiones else list(EXCLUSIONES_DEFAULT)
    pais = pais or "Argentina"
    excl_list = ", ".join(excl + [f"empresa extranjera (fuera de {pais})"])

    rubros_list = ", ".join(rubros_validos)
    system_prompt = (
        f"Sos un clasificador de empresas para un sistema de prospección comercial B2B. "
        f"Tu trabajo es clasificar una empresa en EXACTAMENTE UNA de estas categorías: "
        f"{rubros_list}, no_aplica.\n\n"
        f"Devolvé 'no_aplica' si la empresa es: {excl_list}.\n\n"
        f"Si hay duda, devolvé el rubro más cercano (no 'no_aplica').\n\n"
        f"Respondé SOLO con el nombre exacto del rubro o 'no_aplica'. Sin mayúsculas extra, sin explicación."
    )

    pais_parts = []
    if direccion:
        pais_parts.append(f"Dirección: {direccion}")
    if tld:
        pais_parts.append(f"TLD: .{tld}")
    pais_block = ("\n\nSeñales de país:\n" + "\n".join(pais_parts)) if pais_parts else ""

    user_msg = (
        f"Empresa: {nombre_empresa or '(sin nombre)'}\n\n"
        f"Texto web:\n\"\"\"\n{texto_pagina[:800]}\n\"\"\""
        f"{pais_block}"
    )

    try:
        resp = requests.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key":         anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json={
                "model":      ANTHROPIC_MODEL,
                "max_tokens": 20,
                "system":     system_prompt,
                "messages":   [{"role": "user", "content": user_msg}],
            },
            timeout=15,
        )
    except Exception as e:
        print(f"[CLASIF ERROR] {type(e).__name__}: {e}")
        return rubros_validos[0] if rubros_validos else "no_aplica"

    if resp.status_code != 200:
        print(f"[CLASIF ERROR] HTTP {resp.status_code}: {resp.text[:200]}")
        return rubros_validos[0] if rubros_validos else "no_aplica"

    try:
        data = resp.json()
        text = (data.get("content") or [{}])[0].get("text", "").strip().lower()
        text = re.sub(r'[^a-z_\s]', '', text).strip()
    except Exception as e:
        print(f"[CLASIF ERROR] parse: {e}")
        return rubros_validos[0] if rubros_validos else "no_aplica"

    if text == "no_aplica":
        return "no_aplica"
    # Buscar match exacto o parcial en los rubros del tenant
    for rubro in rubros_validos:
        if rubro.lower() == text or rubro.lower() in text:
            return rubro
    print(f"[CLASIF WARN] respuesta inesperada {text!r}")
    return rubros_validos[0] if rubros_validos else "no_aplica"
