from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://plataforma:plataforma@localhost:5432/plataforma"
    SECRET_KEY: str = "dev-secret-change-in-prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 43200  # 30 días (default; prod lo fija en compose)
    WEBHOOK_TOKEN: str = "dev-webhook-token"
    # Token que usa el webhook de Camila para espejar leads/prospects de Etiguel
    # a la app (APP.7). Si queda vacío, cae de fallback a WEBHOOK_TOKEN.
    ETIGUEL_MIRROR_TOKEN: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
