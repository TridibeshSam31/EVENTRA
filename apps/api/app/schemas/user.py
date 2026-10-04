"""Pydantic Schemas: User"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr


class UserBase(BaseModel):
    name: str
    email: str
    phone_e164: Optional[str] = None


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone_e164: Optional[str] = None


class UserPhoneUpdate(BaseModel):
    phone: str


class UserResponse(UserBase):
    id: str
    phone_e164: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
