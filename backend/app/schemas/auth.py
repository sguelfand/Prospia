from __future__ import annotations
from pydantic import BaseModel, Field


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


class UpdateProfileRequest(BaseModel):
    nombre: str | None = None
    email: str = Field(min_length=3)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)
