from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://plataforma:plataforma@localhost:5432/plataforma"
    SECRET_KEY: str = "dev-secret-change-in-prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 525600  # 1 año (default; prod lo fija en compose)
    WEBHOOK_TOKEN: str = "dev-webhook-token"
    # Token que usa el webhook de Camila para espejar leads/prospects de Etiguel
    # a la app (APP.7). Si queda vacío, cae de fallback a WEBHOOK_TOKEN.
    ETIGUEL_MIRROR_TOKEN: str = ""
    # Deploy token del webhook de Etiguel (mismo X-Deploy-Token). Lo usa el
    # monitoreo para consultar /camila-config/diag y saber si el gateway de
    # Camila está vivo. Si queda vacío, ese check queda en "unknown".
    ETIGUEL_DEPLOY_TOKEN: str = ""
    # Base URL del webhook de Etiguel para relayear la respuesta de una consulta a
    # Camila (POST /responder-consulta, auth X-Deploy-Token = ETIGUEL_DEPLOY_TOKEN).
    ETIGUEL_WEBHOOK_URL: str = "https://webhook.etiguel.net"
    # Key de Anthropic para los asistentes IA del relevamiento (Haiku). Fallback
    # si monitor_settings.anthropic_api_key está vacío. Se setea por DB en prod.
    ANTHROPIC_API_KEY: str = ""
    # Resend: mails transaccionales (aviso de consulta a clientes). Sender único
    # para todos los tenants. Si RESEND_API_KEY está vacío, no se manda mail.
    RESEND_API_KEY: str = ""
    RESEND_FROM: str = "Prospia <notificaciones@prospia.app>"
    # Base pública de la web (para los links en los mails al cliente).
    PROSPIA_WEB_URL: str = "https://prospia.app"

    class Config:
        env_file = ".env"


settings = Settings()
