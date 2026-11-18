from .worker import celery_app


@celery_app.task(name="meetings.generate_summary")
def generate_summary(transcript_segments: list[dict]) -> dict:
    raise NotImplementedError(
        "Choose and approve an LLM provider after privacy review before enabling summary generation."
    )