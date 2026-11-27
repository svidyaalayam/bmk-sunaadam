from django.urls import path

from .authentication import (
    auth_login,
    auth_logout,
    auth_me,
    auth_password_reset_confirm,
    auth_password_reset_request,
    auth_profile,
    auth_register,
    csrf_token,
)
from .views import (
    class_homeworks,
    claim_practice_recordings,
    complete_homework,
    curriculum,
    delete_practice_recording,
    lessons,
    music_classes,
    practice_recording_audio,
    practice_recording_comments,
    practice_recording_listened,
    practice_recording_rating,
    practice_recordings,
)

urlpatterns = [
    path("curriculum/", curriculum, name="curriculum"),
    path("lessons/", lessons, name="lessons"),
    path("music-classes/", music_classes, name="music-classes"),
    path("homeworks/", class_homeworks, name="class-homeworks"),
    path(
        "homeworks/<int:homework_id>/completion/",
        complete_homework,
        name="complete-homework",
    ),
    path("auth/csrf/", csrf_token, name="auth-csrf"),
    path("auth/me/", auth_me, name="auth-me"),
    path("auth/register/", auth_register, name="auth-register"),
    path("auth/login/", auth_login, name="auth-login"),
    path("auth/logout/", auth_logout, name="auth-logout"),
    path("auth/profile/", auth_profile, name="auth-profile"),
    path(
        "auth/password-reset/",
        auth_password_reset_request,
        name="auth-password-reset",
    ),
    path(
        "auth/password-reset/confirm/",
        auth_password_reset_confirm,
        name="auth-password-reset-confirm",
    ),
    path("recordings/claim/", claim_practice_recordings, name="claim-practice-recordings"),
    path("recordings/", practice_recordings, name="practice-recordings"),
    path(
        "recordings/<int:recording_id>/comments/",
        practice_recording_comments,
        name="practice-recording-comments",
    ),
    path(
        "recordings/<int:recording_id>/comments/<int:comment_id>/",
        practice_recording_comments,
        name="practice-recording-comment",
    ),
    path(
        "recordings/<int:recording_id>/listen/",
        practice_recording_listened,
        name="practice-recording-listened",
    ),
    path(
        "recordings/<int:recording_id>/rating/",
        practice_recording_rating,
        name="practice-recording-rating",
    ),
    path(
        "recordings/<int:recording_id>/",
        delete_practice_recording,
        name="delete-practice-recording",
    ),
    path(
        "recordings/<int:recording_id>/audio/",
        practice_recording_audio,
        name="practice-recording-audio",
    ),
]
