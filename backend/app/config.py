from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    storage_root: str = "/storage"
    secret_key: str
    admin_email: str = "admin@admin.ru"
    admin_password: str = "admin"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24

    class Config:
        env_file = ".env"
        case_sensitive = False
    

settings = Settings()