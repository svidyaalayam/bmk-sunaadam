import json
from datetime import date
from uuid import UUID

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, F, Sum
from django.http import FileResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import (
    ClassHomework,
    Exercise,
    HomeworkCompletion,
    Lesson,
    Melakarta,
    MusicClass,
    PracticeRecording,
    Ragam,
    Session,
    Talam,
    TeacherRecordingComment,
    UserProfile,
)


MAX_PRACTICE_RECORDING_BYTES = 100 * 1024 * 1024
MAX_RECORDING_SETTINGS_BYTES = 4 * 1024 * 1024
PRACTICE_AUDIO_TYPES = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "audio/mpeg": ".mp3",
}


def recording_owner_key(request):
    try:
        return UUID(request.headers.get("X-Recording-Owner", ""))
    except (ValueError, AttributeError):
        return None


def claim_legacy_recordings(user, owner_key):
    return PracticeRecording.objects.filter(
        owner_key=owner_key,
        user__isnull=True,
    ).update(user=user, owner_key=None)


def practice_recording_data(recording):
    teacher_comment_count = getattr(recording, "teacher_comment_count", None)
    if teacher_comment_count is None:
        teacher_comment_count = recording.teacher_comments.count()
    return {
        "id": recording.id,
        "exerciseId": recording.exercise_id,
        "exerciseTitle": recording.exercise_title,
        "sessionName": recording.exercise.session.name,
        "settings": recording.settings,
        "createdAt": recording.created_at.isoformat(),
        "listenCount": recording.listen_count,
        "teacherRating": recording.teacher_rating,
        "teacherCommentCount": teacher_comment_count,
        "audioUrl": f"/api/recordings/{recording.id}/audio/",
    }


def user_role(user):
    if user.is_superuser:
        return UserProfile.Role.ADMIN
    return UserProfile.objects.filter(user=user).values_list("role", flat=True).first()


def user_summary(user):
    profile = UserProfile.objects.filter(user=user).first()
    email = (profile.email if profile else "") or user.email
    name = f"{user.first_name} {user.last_name}".strip() or email
    return {"id": user.id, "name": name, "email": email}


def music_class_summary(music_class):
    return {
        "id": music_class.id,
        "name": music_class.name,
        "teacher": user_summary(music_class.teacher),
        "students": [user_summary(student) for student in music_class.students.all()],
    }


def homework_summary(homework, user):
    result = {
        "id": homework.id,
        "classId": homework.music_class_id,
        "className": homework.music_class.name,
        "title": homework.title,
        "description": homework.description,
        "dueDate": homework.due_date.isoformat() if homework.due_date else None,
        "createdAt": homework.created_at.isoformat(),
    }
    if user_role(user) == UserProfile.Role.TEACHER:
        result["completions"] = [
            {
                "student": user_summary(completion.student),
                "completed": completion.completed_at is not None,
                "completedAt": (
                    completion.completed_at.isoformat() if completion.completed_at else None
                ),
                "note": completion.note,
            }
            for completion in homework.completions.select_related("student").all()
        ]
    else:
        completion = homework.completions.filter(student=user).first()
        result.update({
            "completed": bool(completion and completion.completed_at),
            "completionNote": completion.note if completion else "",
            "completedAt": (
                completion.completed_at.isoformat()
                if completion and completion.completed_at
                else None
            ),
        })
    return result


@csrf_exempt
def lessons(request):
    if request.method == "GET":
        return JsonResponse({"lessons": [lesson.as_dict() for lesson in Lesson.objects.all()]})

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    try:
        payload = json.loads(request.body)
        incoming = payload.get("lessons", [])
        if not isinstance(incoming, list):
            raise ValueError("lessons must be an array")
    except (json.JSONDecodeError, ValueError) as error:
        return JsonResponse({"error": str(error)}, status=400)

    Lesson.objects.all().delete()
    created = []
    for position, item in enumerate(incoming):
        lesson = Lesson.objects.create(
            title=str(item.get("title", f"Lesson {position + 1}"))[:120],
            notes=str(item.get("notes", "")),
            talam_beats=max(1, min(32, int(item.get("talamBeats", 8)))),
            note_duration_fixed=bool(item.get("noteDurationFixed", False)),
            position=position,
        )
        created.append(lesson.as_dict())

    return JsonResponse({"lessons": created}, status=201)


def curriculum(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    return JsonResponse(
        {
            "sessions": [session.as_dict() for session in Session.objects.all()],
            "talams": [talam.as_dict() for talam in Talam.objects.all()],
            "melakartas": [melakarta.as_dict() for melakarta in Melakarta.objects.all()],
            "ragams": [ragam.as_dict() for ragam in Ragam.objects.select_related("melakarta")],
            "exercises": [
                exercise.as_dict()
                for exercise in Exercise.objects.select_related(
                    "talam",
                    "session",
                    "melakarta",
                    "ragam__melakarta",
                ).prefetch_related(
                    "sections",
                    "playback_sequence",
                    "playback_parts",
                )
            ],
        }
    )


def validate_recording_settings(settings_payload):
    if len(settings_payload.encode("utf-8")) > MAX_RECORDING_SETTINGS_BYTES:
        raise ValueError("Recording settings exceed the 4 MB limit.")

    settings = json.loads(settings_payload)
    if not isinstance(settings, dict):
        raise ValueError("Recording settings must be a JSON object.")

    bpm = settings.get("bpm")
    if not isinstance(bpm, int) or isinstance(bpm, bool) or not 20 <= bpm <= 300:
        raise ValueError("Recording BPM must be a whole number between 20 and 300.")
    if not isinstance(settings.get("shruthi"), str) or not settings["shruthi"]:
        raise ValueError("Recording shruthi is required.")
    if not isinstance(settings.get("excludedPartKeys"), list) or not all(
        isinstance(key, str) for key in settings["excludedPartKeys"]
    ):
        raise ValueError("Excluded part keys must be an array of strings.")
    if not isinstance(settings.get("playbackSchedule"), list) or not isinstance(
        settings.get("displaySchedule"), list
    ):
        raise ValueError("The saved exercise playback snapshot is incomplete.")
    if not isinstance(settings.get("exerciseSections"), list) or not isinstance(
        settings.get("exerciseSnapshot"), dict
    ):
        raise ValueError("The saved exercise data is incomplete.")

    beats = settings.get("beats")
    if not isinstance(beats, int) or isinstance(beats, bool) or not 1 <= beats <= 256:
        raise ValueError("The saved Talam beat count is invalid.")
    cycles_per_row = settings.get("cyclesPerRow")
    if not isinstance(cycles_per_row, int) or isinstance(cycles_per_row, bool) or cycles_per_row < 1:
        raise ValueError("The saved Talam cycle count is invalid.")
    if not isinstance(settings.get("beatGroups"), list) or not all(
        isinstance(group, int) and not isinstance(group, bool) and group > 0
        for group in settings["beatGroups"]
    ):
        raise ValueError("The saved Talam beat groups are invalid.")
    if not isinstance(settings.get("beatNumbers"), list) or not all(
        isinstance(number, int) and not isinstance(number, bool)
        for number in settings["beatNumbers"]
    ):
        raise ValueError("The saved Talam beat numbers are invalid.")

    duration = settings.get("totalDuration")
    if (
        not isinstance(duration, (int, float))
        or isinstance(duration, bool)
        or not 0 < duration <= 86400
    ):
        raise ValueError("The saved exercise duration is invalid.")
    if not isinstance(settings["exerciseSnapshot"].get("talamName"), str):
        raise ValueError("The saved Talam name is invalid.")
    if not isinstance(settings.get("swaraIntervals"), (dict, type(None))):
        raise ValueError("The saved Ragam intervals are invalid.")
    return settings


def practice_recordings(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in to access practice recordings."}, status=401)

    if request.method == "GET":
        class_id = request.GET.get("class_id")
        selected_class = None
        if class_id:
            if user_role(request.user) != UserProfile.Role.TEACHER:
                return JsonResponse({"error": "Only teachers can view class recordings."}, status=403)
            try:
                selected_class = MusicClass.objects.prefetch_related("students").get(
                    id=int(class_id),
                    teacher=request.user,
                )
            except (MusicClass.DoesNotExist, ValueError):
                return JsonResponse({"error": "Music class not found."}, status=404)
            recordings = PracticeRecording.objects.filter(
                user__in=selected_class.students.all(),
            ).select_related("user", "exercise__session").order_by("-created_at")
        else:
            recordings = PracticeRecording.objects.filter(user=request.user).select_related(
                "exercise__session",
            ).order_by("-created_at")
        exercise_id = request.GET.get("exercise_id")
        if exercise_id:
            try:
                recordings = recordings.filter(exercise_id=int(exercise_id))
            except ValueError:
                return JsonResponse(
                    {"error": "A valid exercise_id query parameter is required."},
                    status=400,
                )

        counts = recordings.values("user_id", "exercise_id").annotate(total=Sum("listen_count"))
        exercise_counts = {
            (item["user_id"], item["exercise_id"]): item["total"] for item in counts
        }
        recordings = recordings.annotate(teacher_comment_count=Count("teacher_comments"))
        data = []
        for recording in recordings:
            item = practice_recording_data(recording)
            item["exerciseListenCount"] = exercise_counts.get(
                (recording.user_id, recording.exercise_id),
                0,
            )
            if selected_class:
                item["studentName"] = user_summary(recording.user)["name"]
            data.append(item)
        return JsonResponse({"recordings": data})

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    uploaded_audio = request.FILES.get("audio")
    if uploaded_audio is None:
        return JsonResponse({"error": "An audio file is required."}, status=400)
    if uploaded_audio.size <= 0 or uploaded_audio.size > MAX_PRACTICE_RECORDING_BYTES:
        return JsonResponse({"error": "Audio must be between 1 byte and 100 MB."}, status=400)

    audio_type = (uploaded_audio.content_type or "").split(";", 1)[0].strip().lower()
    audio_extension = PRACTICE_AUDIO_TYPES.get(audio_type)
    if audio_extension is None:
        return JsonResponse(
            {"error": f"Unsupported audio type: {audio_type or 'unknown'}."},
            status=415,
        )

    try:
        exercise_id = int(request.POST.get("exercise_id", ""))
        exercise = Exercise.objects.get(id=exercise_id)
        settings = validate_recording_settings(request.POST.get("settings", ""))
    except Exercise.DoesNotExist:
        return JsonResponse(
            {"error": "The selected exercise no longer exists on the backend."},
            status=404,
        )
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return JsonResponse({"error": str(error) or "Invalid recording metadata."}, status=400)

    uploaded_audio.name = f"practice-recording{audio_extension}"
    owner_key = recording_owner_key(request)
    if owner_key is not None:
        claim_legacy_recordings(request.user, owner_key)
    recording = PracticeRecording.objects.create(
        user=request.user,
        exercise=exercise,
        exercise_title=exercise.title,
        audio=uploaded_audio,
        audio_content_type=audio_type,
        settings=settings,
    )
    return JsonResponse({"recording": practice_recording_data(recording)}, status=201)


def practice_recording_listened(request, recording_id):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in to track practice listens."}, status=401)

    updated = PracticeRecording.objects.filter(
        id=recording_id,
        user=request.user,
    ).update(listen_count=F("listen_count") + 1)
    if not updated:
        return JsonResponse({"error": "Recording not found."}, status=404)

    recording = PracticeRecording.objects.get(id=recording_id, user=request.user)
    exercise_listen_count = PracticeRecording.objects.filter(
        user=request.user,
        exercise_id=recording.exercise_id,
    ).aggregate(total=Sum("listen_count"))["total"] or 0
    return JsonResponse({
        "recordingId": recording.id,
        "listenCount": recording.listen_count,
        "exerciseId": recording.exercise_id,
        "exerciseListenCount": exercise_listen_count,
    })


@csrf_exempt
def practice_recording_rating(request, recording_id):
    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in to rate practice recordings."}, status=401)
    if user_role(request.user) != UserProfile.Role.TEACHER:
        return JsonResponse({"error": "Only teachers can rate practice recordings."}, status=403)

    recording = PracticeRecording.objects.filter(id=recording_id).select_related("user").first()
    if recording is None or not can_access_recording(request.user, recording):
        return JsonResponse({"error": "Recording not found."}, status=404)

    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        rating = payload.get("rating")
        if rating is not None and (
            not isinstance(rating, int)
            or isinstance(rating, bool)
            or not 0 <= rating <= 100
        ):
            raise ValueError("Rating must be a whole-number percentage from 0 to 100.")
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return JsonResponse({"error": str(error) or "Invalid rating."}, status=400)

    recording.teacher_rating = rating
    recording.save(update_fields=["teacher_rating"])
    return JsonResponse({"recordingId": recording.id, "teacherRating": rating})


def delete_practice_recording(request, recording_id):
    if request.method != "DELETE":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in to delete practice recordings."}, status=401)

    try:
        recording = PracticeRecording.objects.get(id=recording_id, user=request.user)
    except PracticeRecording.DoesNotExist:
        return JsonResponse({"error": "Recording not found."}, status=404)

    if recording.audio:
        recording.audio.storage.delete(recording.audio.name)
    recording.delete()
    return JsonResponse({}, status=200)


def claim_practice_recordings(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in to claim practice recordings."}, status=401)
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    owner_key = recording_owner_key(request)
    if owner_key is None:
        return JsonResponse({"error": "A valid recording owner key is required."}, status=400)
    claimed_count = claim_legacy_recordings(request.user, owner_key)
    return JsonResponse({"claimedCount": claimed_count})


def practice_recording_audio(request, recording_id):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in to access practice recordings."}, status=401)

    recording = PracticeRecording.objects.filter(id=recording_id).select_related("user").first()
    if recording is None or not can_access_recording(request.user, recording):
        return JsonResponse({"error": "Recording not found."}, status=404)

    return FileResponse(
        recording.audio.open("rb"),
        as_attachment=True,
        filename=recording.audio.name.rsplit("/", 1)[-1],
        content_type=recording.audio_content_type,
    )


def can_access_recording(user, recording):
    if recording.user_id == user.id:
        return True
    return (
        user_role(user) == UserProfile.Role.TEACHER
        and recording.user_id is not None
        and MusicClass.objects.filter(
            teacher=user,
            students=recording.user,
        ).exists()
    )


def recording_comment_data(comment, user=None):
    data = {
        "id": comment.id,
        "teacherName": user_summary(comment.teacher)["name"],
        "scope": comment.scope,
        "tableIndex": comment.table_index,
        "rowIndex": comment.row_index,
        "noteIndex": comment.note_index,
        "comment": comment.comment,
        "createdAt": comment.created_at.isoformat(),
    }
    if user is not None:
        data["canEdit"] = (
            user_role(user) == UserProfile.Role.TEACHER
            and comment.teacher_id == user.id
        )
    return data


def practice_recording_comments(request, recording_id, comment_id=None):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in to access recording comments."}, status=401)

    recording = PracticeRecording.objects.filter(id=recording_id).select_related("user").first()
    if recording is None or not can_access_recording(request.user, recording):
        return JsonResponse({"error": "Recording not found."}, status=404)

    if request.method == "GET":
        if comment_id is not None:
            return JsonResponse({"error": "Method not allowed."}, status=405)
        comments = recording.teacher_comments.select_related("teacher").all()
        return JsonResponse({
            "comments": [recording_comment_data(item, request.user) for item in comments]
        })
    if request.method not in {"POST", "PATCH", "DELETE"}:
        return JsonResponse({"error": "Method not allowed."}, status=405)
    if user_role(request.user) != UserProfile.Role.TEACHER:
        return JsonResponse({"error": "Only teachers can manage recording comments."}, status=403)
    if comment_id is not None:
        try:
            comment = recording.teacher_comments.get(id=comment_id)
        except TeacherRecordingComment.DoesNotExist:
            return JsonResponse({"error": "Comment not found."}, status=404)
        if comment.teacher_id != request.user.id:
            return JsonResponse({"error": "Only the teacher who wrote this comment can edit or delete it."}, status=403)
        if request.method == "DELETE":
            comment.delete()
            return JsonResponse({}, status=200)
        if request.method != "PATCH":
            return JsonResponse({"error": "Method not allowed."}, status=405)
        try:
            payload = json.loads(request.body)
            if not isinstance(payload, dict):
                raise ValueError("Request body must be a JSON object.")
            comment_text = payload.get("comment")
            if not isinstance(comment_text, str) or not comment_text.strip() or len(comment_text) > 2000:
                raise ValueError("Comment must be between 1 and 2,000 characters.")
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            return JsonResponse({"error": str(error) or "Invalid comment details."}, status=400)
        comment.comment = comment_text.strip()
        comment.save(update_fields=["comment"])
        return JsonResponse({"comment": recording_comment_data(comment, request.user)})
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        scope = payload.get("scope")
        if scope not in TeacherRecordingComment.Scope.values:
            raise ValueError("Choose a table, row, or note comment.")
        table_index = payload.get("tableIndex")
        row_index = payload.get("rowIndex")
        note_index = payload.get("noteIndex")
        comment_text = payload.get("comment")
        if (
            not isinstance(table_index, int)
            or isinstance(table_index, bool)
            or table_index < 0
        ):
            raise ValueError("Choose a valid table.")
        display_schedule = recording.settings.get("displaySchedule")
        if not isinstance(display_schedule, list) or table_index >= len(display_schedule):
            raise ValueError("The selected table is not in this recording.")
        if not isinstance(comment_text, str) or not comment_text.strip() or len(comment_text) > 2000:
            raise ValueError("Comment must be between 1 and 2,000 characters.")
        if scope in {TeacherRecordingComment.Scope.ROW, TeacherRecordingComment.Scope.NOTE}:
            if not isinstance(row_index, int) or isinstance(row_index, bool) or row_index < 0:
                raise ValueError("Choose a valid row.")
        elif row_index is not None or note_index is not None:
            raise ValueError("Table comments cannot include a row or note.")
        if scope == TeacherRecordingComment.Scope.NOTE:
            if not isinstance(note_index, int) or isinstance(note_index, bool) or note_index < 0:
                raise ValueError("Choose a valid note.")
        elif note_index is not None:
            raise ValueError("Only note comments can include a note index.")
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return JsonResponse({"error": str(error) or "Invalid comment details."}, status=400)

    comment = TeacherRecordingComment.objects.create(
        recording=recording,
        teacher=request.user,
        scope=scope,
        table_index=table_index,
        row_index=row_index,
        note_index=note_index,
        comment=comment_text.strip(),
    )
    return JsonResponse({"comment": recording_comment_data(comment, request.user)}, status=201)


def music_classes(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in to access music classes."}, status=401)

    role = user_role(request.user)
    if request.method == "GET":
        if role == UserProfile.Role.ADMIN:
            classes = MusicClass.objects.select_related("teacher").prefetch_related("students")
            teachers = [
                user_summary(profile.user)
                for profile in UserProfile.objects.filter(
                    role=UserProfile.Role.TEACHER,
                ).select_related("user")
            ]
            students = [
                user_summary(profile.user)
                for profile in UserProfile.objects.filter(
                    role=UserProfile.Role.STUDENT,
                ).select_related("user")
            ]
            return JsonResponse({
                "classes": [music_class_summary(item) for item in classes],
                "teachers": teachers,
                "students": students,
            })
        if role == UserProfile.Role.TEACHER:
            classes = MusicClass.objects.filter(teacher=request.user)
        elif role == UserProfile.Role.STUDENT:
            classes = MusicClass.objects.filter(students=request.user)
        else:
            return JsonResponse({"error": "This account cannot access music classes."}, status=403)
        classes = classes.select_related("teacher").prefetch_related("students")
        return JsonResponse({
            "classes": [music_class_summary(item) for item in classes],
            "teachers": [],
            "students": [],
        })

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    if role != UserProfile.Role.ADMIN:
        return JsonResponse({"error": "Only admins can create music classes."}, status=403)
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        name = str(payload.get("name", "")).strip()
        teacher_id = int(payload.get("teacherId", ""))
        student_ids = payload.get("studentIds")
        if not name or len(name) > 120:
            raise ValueError("Enter a class name of 1 to 120 characters.")
        if not isinstance(student_ids, list) or not student_ids:
            raise ValueError("Select at least one student for the class.")
        student_ids = [int(student_id) for student_id in student_ids]
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return JsonResponse({"error": str(error) or "Invalid class details."}, status=400)

    teacher_profile = UserProfile.objects.filter(
        user_id=teacher_id,
        role=UserProfile.Role.TEACHER,
    ).select_related("user").first()
    students = list(
        get_user_model().objects.filter(
            id__in=set(student_ids),
            profile__role=UserProfile.Role.STUDENT,
        )
    )
    if teacher_profile is None:
        return JsonResponse({"error": "Choose a valid teacher account."}, status=400)
    if len(students) != len(set(student_ids)):
        return JsonResponse({"error": "Choose valid student accounts."}, status=400)

    with transaction.atomic():
        music_class = MusicClass.objects.create(
            name=name,
            teacher=teacher_profile.user,
            created_by=request.user,
        )
        music_class.students.set(students)
    return JsonResponse({"class": music_class_summary(music_class)}, status=201)


def class_homeworks(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in to access homework."}, status=401)
    role = user_role(request.user)
    if request.method == "GET":
        if role == UserProfile.Role.TEACHER:
            homeworks = ClassHomework.objects.filter(
                music_class__teacher=request.user,
            ).select_related("music_class").prefetch_related("completions__student")
        elif role == UserProfile.Role.STUDENT:
            homeworks = ClassHomework.objects.filter(
                music_class__students=request.user,
            ).select_related("music_class").distinct()
        else:
            return JsonResponse({"error": "This account cannot access homework."}, status=403)
        return JsonResponse({
            "homeworks": [homework_summary(item, request.user) for item in homeworks]
        })

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    if role != UserProfile.Role.TEACHER:
        return JsonResponse({"error": "Only teachers can assign homework."}, status=403)
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        music_class_id = int(payload.get("classId", ""))
        title = str(payload.get("title", "")).strip()
        description = str(payload.get("description", "")).strip()
        due_date_value = payload.get("dueDate") or ""
        due_date = date.fromisoformat(due_date_value) if due_date_value else None
        if not title or len(title) > 120:
            raise ValueError("Enter a homework title of 1 to 120 characters.")
        if len(description) > 5000:
            raise ValueError("Homework details must be 5,000 characters or fewer.")
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return JsonResponse({"error": str(error) or "Invalid homework details."}, status=400)

    try:
        music_class = MusicClass.objects.get(id=music_class_id, teacher=request.user)
    except MusicClass.DoesNotExist:
        return JsonResponse({"error": "Music class not found."}, status=404)
    homework = ClassHomework.objects.create(
        music_class=music_class,
        title=title,
        description=description,
        due_date=due_date,
        created_by=request.user,
    )
    return JsonResponse({"homework": homework_summary(homework, request.user)}, status=201)


def complete_homework(request, homework_id):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in to update homework."}, status=401)
    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    if user_role(request.user) != UserProfile.Role.STUDENT:
        return JsonResponse({"error": "Only students can submit homework completion."}, status=403)
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        completed = payload.get("completed")
        note = payload.get("note", "")
        if not isinstance(completed, bool):
            raise ValueError("Completion status must be true or false.")
        if not isinstance(note, str) or len(note) > 2000:
            raise ValueError("Completion note must be 2,000 characters or fewer.")
        if completed and not note.strip():
            raise ValueError("Add a note before marking the homework completed.")
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return JsonResponse({"error": str(error) or "Invalid completion details."}, status=400)

    try:
        homework = ClassHomework.objects.select_related("music_class").get(
            id=homework_id,
            music_class__students=request.user,
        )
    except ClassHomework.DoesNotExist:
        return JsonResponse({"error": "Homework not found."}, status=404)
    completion, _ = HomeworkCompletion.objects.get_or_create(
        homework=homework,
        student=request.user,
    )
    completion.note = note.strip()
    completion.completed_at = timezone.now() if completed else None
    completion.save()
    return JsonResponse({"homework": homework_summary(homework, request.user)})
