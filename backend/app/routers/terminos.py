import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.database import get_db
from app.models.termino import Termino
from app.models.user import User
from app.schemas.termino import ScraperStatus, TerminoCreate, TerminoOut
from app.services import scraper as scraper_service

router = APIRouter(prefix="/terminos", tags=["terminos"])


@router.get("", response_model=list[TerminoOut])
def list_terminos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Termino)
        .filter(Termino.tenant_id == current_user.tenant_id)
        .order_by(Termino.created_at.desc())
        .all()
    )


@router.post("", response_model=TerminoOut)
def create_termino(
    body: TerminoCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    termino = Termino(tenant_id=current_user.tenant_id, texto=body.texto)
    db.add(termino)
    db.commit()
    db.refresh(termino)
    return termino


@router.delete("/{termino_id}", status_code=204)
def delete_termino(
    termino_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    termino = db.get(Termino, termino_id)
    if not termino or termino.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Término no encontrado")
    db.delete(termino)
    db.commit()


@router.post("/{termino_id}/scraper/run", response_model=ScraperStatus)
def run_scraper(
    termino_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    termino = db.get(Termino, termino_id)
    if not termino or termino.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Término no encontrado")
    if termino.scraper_running:
        return ScraperStatus(termino_id=termino_id, running=True, message="Ya está corriendo")

    termino.scraper_running = True
    db.commit()

    threading.Thread(
        target=scraper_service.run_scraper,
        args=(termino_id,),
        daemon=True,
    ).start()

    return ScraperStatus(termino_id=termino_id, running=True, message="Scraper iniciado")


@router.get("/{termino_id}/scraper/status", response_model=ScraperStatus)
def scraper_status(
    termino_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    termino = db.get(Termino, termino_id)
    if not termino or termino.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Término no encontrado")
    return ScraperStatus(termino_id=termino_id, running=termino.scraper_running)
