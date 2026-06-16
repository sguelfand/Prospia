from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://plataforma:plataforma@localhost:5432/plataforma"
    SECRET_KEY: str = "dev-secret-change-in-prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    WEBHOOK_TOKEN: str = "dev-webhook-token"

    class Config:
        env_file = ".env"


settings = Settings()
