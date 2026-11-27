import json
from urllib.parse import urlparse
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.forms import PasswordResetForm
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie

from .models import UserProfile


SHRUTHI_VALUES = {
    *(f"lower-{note}" for note in ("G#", "A", "A#", "B")),
    *(f"normal-{note}" for note in ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")),
    *(f"higher-{note}" for note in ("C", "C#", "D", "D#")),
}


def _json_body(request):
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("Request body must be valid JSON.") from None
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object.")
    return body


def _error(message, status=400):
    return JsonResponse({"error": message}, status=status)


def _validation_message(error):
    return " ".join(error.messages) if isinstance(error, ValidationError) else str(error)


def csrf_failure(request, reason=""):
    return JsonResponse(
        {"error": f"Security check failed. Refresh the page and try again. ({reason})"},
        status=403,
    )


def _profile_for(user):
    profile = UserProfile.objects.filter(user=user).first()
    if profile:
        return profile

    email = user.email.strip().lower() if user.email else None
    if email and UserProfile.objects.filter(email__iexact=email).exists():
        email = None
    profile = UserProfile.objects.create(
        user=user,
        email=email,
        role=UserProfile.Role.ADMIN if user.is_superuser else UserProfile.Role.STUDENT,
    )
    return profile


def _user_data(user):
    profile = _profile_for(user)
    return {
        "id": user.pk,
        "email": profile.email or user.email,
        "firstName": user.first_name,
        "surname": user.last_name,
        "parentName": profile.parent_name,
        "musicTeacherName": profile.music_teacher_name,
        "contactNumber": profile.contact_number,
        "address": profile.address,
        "learningMode": profile.learning_mode,
        "instrumentName": profile.instrument_name,
        "defaultShruthi": profile.default_shruthi,
        "role": profile.role,
    }


@ensure_csrf_cookie
def csrf_token(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    return JsonResponse({"csrfToken": get_token(request)})


def auth_me(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    return JsonResponse({"user": _user_data(request.user) if request.user.is_authenticated else None})


def auth_register(request):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    try:
        data = _json_body(request)
        email = str(data.get("email", "")).strip().lower()
        validate_email(email)
    except (ValueError, ValidationError) as error:
        return _error(_validation_message(error) or "Enter a valid email address.")

    if len(email) > 254:
        return _error("Email address must be 254 characters or fewer.")
    User = get_user_model()
    if (
        User.objects.filter(email__iexact=email).exists()
        or UserProfile.objects.filter(email__iexact=email).exists()
    ):
        return _error("An account with this email address already exists.")

    password = data.get("password")
    if not isinstance(password, str) or not password:
        return _error("Password is required.")
    if password != data.get("passwordConfirm"):
        return _error("Passwords do not match.")
    learning_mode = data.get("learningMode", "")
    if not isinstance(learning_mode, str) or (
        learning_mode not in dict(UserProfile.LearningMode.choices) and learning_mode != ""
    ):
        return _error("Choose Vocal or Instrument.")
    instrument_name = str(data.get("instrumentName", "")).strip()
    if learning_mode == UserProfile.LearningMode.INSTRUMENT and not instrument_name:
        return _error("Enter the instrument name.")
    default_shruthi = data.get("defaultShruthi", "normal-G")
    if not isinstance(default_shruthi, str) or default_shruthi not in SHRUTHI_VALUES:
        return _error("Choose a valid default shruthi.")

    user = User(
        username=uuid4().hex,
        email=email,
        first_name=str(data.get("firstName", "")).strip()[:150],
        last_name=str(data.get("surname", "")).strip()[:150],
    )
    try:
        validate_password(password, user)
    except ValidationError as error:
        return _error(error.messages)

    try:
        with transaction.atomic():
            user.set_password(password)
            user.save()
            UserProfile.objects.create(
                user=user,
                email=email,
                parent_name=str(data.get("parentName", "")).strip()[:150],
                music_teacher_name=str(data.get("musicTeacherName", "")).strip()[:150],
                contact_number=str(data.get("contactNumber", "")).strip()[:40],
                address=str(data.get("address", "")).strip(),
                instrument_name=(
                    instrument_name[:120]
                    if learning_mode == UserProfile.LearningMode.INSTRUMENT
                    else ""
                ),
                default_shruthi=default_shruthi,
                learning_mode=learning_mode,
            )
    except IntegrityError:
        return _error("An account with this email address already exists.")

    login(request, user, backend="lessons.authentication_backend.EmailAuthenticationBackend")
    return JsonResponse({"user": _user_data(user)}, status=201)


def auth_login(request):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    try:
        data = _json_body(request)
    except ValueError as error:
        return _error(str(error))

    email = str(data.get("email", "")).strip().lower()
    password = data.get("password")
    if not isinstance(password, str) or not password:
        return _error("Email or password is incorrect.", 400)
    user = authenticate(request, username=email, password=password)
    if user is None:
        return _error("Email or password is incorrect.", 400)
    login(request, user)
    return JsonResponse({"user": _user_data(user)})


def auth_logout(request):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    logout(request)
    return JsonResponse({"user": None})


def auth_profile(request):
    if not request.user.is_authenticated:
        return _error("Sign in to update your details.", 401)
    if request.method != "PATCH":
        return _error("Method not allowed.", 405)
    try:
        data = _json_body(request)
    except ValueError as error:
        return _error(str(error))

    profile = _profile_for(request.user)
    profile.parent_name = str(data.get("parentName", "")).strip()[:150]
    profile.music_teacher_name = str(data.get("musicTeacherName", "")).strip()[:150]
    profile.contact_number = str(data.get("contactNumber", "")).strip()[:40]
    profile.address = str(data.get("address", "")).strip()
    learning_mode = data.get("learningMode", "")
    if not isinstance(learning_mode, str) or (
        learning_mode not in dict(UserProfile.LearningMode.choices) and learning_mode != ""
    ):
        return _error("Choose Vocal or Instrument.")
    instrument_name = str(data.get("instrumentName", "")).strip()
    if learning_mode == UserProfile.LearningMode.INSTRUMENT and not instrument_name:
        return _error("Enter the instrument name.")
    profile.instrument_name = (
        instrument_name[:120]
        if learning_mode == UserProfile.LearningMode.INSTRUMENT
        else ""
    )
    default_shruthi = data.get("defaultShruthi", profile.default_shruthi)
    if not isinstance(default_shruthi, str) or default_shruthi not in SHRUTHI_VALUES:
        return _error("Choose a valid default shruthi.")
    profile.default_shruthi = default_shruthi
    profile.learning_mode = learning_mode
    request.user.first_name = str(data.get("firstName", "")).strip()[:150]
    request.user.last_name = str(data.get("surname", "")).strip()[:150]
    with transaction.atomic():
        request.user.save(update_fields=["first_name", "last_name"])
        profile.save()
    return JsonResponse({"user": _user_data(request.user)})


def auth_password_reset_request(request):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    try:
        data = _json_body(request)
        email = str(data.get("email", "")).strip().lower()
        validate_email(email)
    except (ValueError, ValidationError) as error:
        return _error(_validation_message(error) or "Enter a valid email address.")

    frontend = urlparse(settings.FRONTEND_BASE_URL)
    form = PasswordResetForm({"email": email})
    if form.is_valid():
        form.save(
            request=request,
            use_https=frontend.scheme == "https",
            domain_override=frontend.netloc,
            email_template_name="lessons/password_reset_email.txt",
        )
    return JsonResponse({
        "message": "If an account exists for that email address, a password reset link has been sent."
    })


def auth_password_reset_confirm(request):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    try:
        data = _json_body(request)
        uid = force_str(urlsafe_base64_decode(data.get("uid", "")))
        user = get_user_model().objects.get(pk=uid)
    except (ValueError, TypeError, get_user_model().DoesNotExist):
        return _error("This password reset link is invalid or has expired.")

    token = data.get("token", "")
    if not isinstance(token, str) or not default_token_generator.check_token(user, token):
        return _error("This password reset link is invalid or has expired.")

    password = data.get("password")
    if not isinstance(password, str) or not password:
        return _error("Password is required.")
    try:
        validate_password(password, user)
    except ValidationError as error:
        return _error(error.messages)

    user.set_password(password)
    user.save(update_fields=["password"])
    return JsonResponse({"message": "Your password has been reset. You can now sign in."})
