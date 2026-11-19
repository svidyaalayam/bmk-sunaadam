import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .models import Exercise, Lesson, Melakarta, Ragam, Session, Talam


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
