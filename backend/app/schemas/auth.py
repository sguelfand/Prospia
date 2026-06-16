from __future__ import annotations
from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserMe(BaseModel):
    id: int
    tenant_id: int
    email: str
    nombre: str | None
    role: str

    model_config = {"from_attributes": True}
