from app.models.tenant import Tenant, TenantConfig
from app.models.user import User
from app.models.rubro import Rubro
from app.models.termino import Termino
from app.models.prospect import Prospect
from app.models.historial import ProspectHistorial
from app.models.mensaje import ProspectMensaje
from app.models.device import Device
from app.models.push_mute import PushMute

__all__ = ["Tenant", "TenantConfig", "User", "Rubro", "Termino", "Prospect", "ProspectHistorial", "ProspectMensaje", "Device", "PushMute"]
