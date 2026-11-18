import os


class Settings:
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://gather:gather@localhost:5432/gather",
    )
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    secret_key = os.getenv("SECRET_KEY", "dev-only-change-this-secret-32-bytes-minimum")
    app_env = os.getenv("APP_ENV", "development")
    cors_origins = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
        if origin.strip()
    ]
    llm_provider = os.getenv("LLM_PROVIDER", "disabled")
    llm_api_key = os.getenv("LLM_API_KEY", "")


settings = Settings()