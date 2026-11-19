import json

from django.contrib import admin, messages
from django.http import HttpResponse, JsonResponse
from django import forms
from django.forms.utils import flatatt
from django.shortcuts import redirect, render
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join

from .models import (
    Exercise,
    ExercisePlaybackPart,
    ExerciseSection,
    Lesson,
    Melakarta,
    Ragam,
    Session,
    Talam,
)


class ExerciseSectionInline(admin.StackedInline):
    model = ExerciseSection
    extra = 1
    ordering = ("position",)


class SectionSequenceWidget(forms.TextInput):
    def __init__(self, choices=(), *args, **kwargs):
        self.section_choices = choices
        super().__init__(*args, **kwargs)

    def render(self, name, value, attrs=None, renderer=None):
        attrs = attrs or {}
        attrs["class"] = f"{attrs.get('class', '')} sequence-input".strip()
        attrs["value"] = value or ""
        options = format_html_join(
            "",
            '<option value="{0}">{0}</option>',
            ((title,) for title in self.section_choices),
        )
        return format_html(
            '<input type="text" name="{0}"{1}>'
            '<select class="section-picker" onchange="'
            "const input=this.parentElement.querySelector('.sequence-input');"
            "if(this.value){{input.value=input.value ? input.value + ', ' + this.value : this.value;}}"
            "this.selectedIndex=0;"
            '"><option value="">Add a section…</option>{2}</select>',
            name,
            flatatt(attrs),
            options,
        )


class ExercisePlaybackPartForm(forms.ModelForm):
    section_order = forms.CharField(
        label="Sections (in order)",
        required=False,
        help_text="Enter section titles separated by commas. Repeated titles are allowed.",
    )

    class Meta:
        model = ExercisePlaybackPart
        fields = ("name", "step_number", "position", "section_order", "notes_per_beat", "repeat_count")

    def __init__(self, *args, **kwargs):
        parent_exercise = kwargs.pop("parent_exercise", None)
        super().__init__(*args, **kwargs)
        exercise = (
            Exercise.objects.filter(id=self.instance.exercise_id).first()
            if self.instance.exercise_id
            else parent_exercise
        )
        self.set_parent_exercise(exercise)

    def set_parent_exercise(self, exercise):
        sections = exercise.sections.all() if exercise else ExerciseSection.objects.none()
        self.section_choices = {section.title.strip().lower(): section.id for section in sections}
        self.fields["section_order"].widget = SectionSequenceWidget(
            [section.title for section in sections],
        )
        if self.instance.pk and not self.is_bound:
            ids = self.instance.section_order or ([self.instance.section_id] if self.instance.section_id else [])
            titles = {section.id: section.title for section in sections}
            self.initial["section_order"] = ", ".join(
                titles[section_id] for section_id in ids if section_id in titles
            )

    def clean_section_order(self):
        value = self.cleaned_data.get("section_order", "")
        titles = [title.strip() for title in value.split(",") if title.strip()]
        section_ids = [self.section_choices.get(title.lower()) for title in titles]
        if not titles or any(section_id is None for section_id in section_ids):
            valid = ", ".join(sorted(self.section_choices))
            raise forms.ValidationError(f"Use section titles from this exercise: {valid}.")
        return section_ids

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.section_order = self.cleaned_data["section_order"]
        instance.section_id = instance.section_order[0]
        if commit:
            instance.save()
        return instance


class ExercisePlaybackPartInline(admin.TabularInline):
    model = ExercisePlaybackPart
    form = ExercisePlaybackPartForm
    extra = 1
    ordering = ("step_number", "position")
    fields = ("name", "step_number", "position", "section_order", "notes_per_beat", "repeat_count")

    def get_formset(self, request, obj=None, **kwargs):
        base_formset = super().get_formset(request, obj, **kwargs)

        class ExercisePlaybackPartFormSet(base_formset):
            def _construct_form(self, index, **form_kwargs):
                form = super()._construct_form(index, **form_kwargs)
                form.set_parent_exercise(obj)
                return form

        return ExercisePlaybackPartFormSet


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = ("name", "parent", "allow_ragam_change", "position")
    list_filter = ("parent", "allow_ragam_change")
    search_fields = ("name",)
    ordering = ("position", "name")


@admin.register(Talam)
class TalamAdmin(admin.ModelAdmin):
    list_display = ("name", "beats", "cycles_per_row", "beat_groups", "beat_numbers")
    search_fields = ("name",)
    ordering = ("name",)


@admin.register(Melakarta)
class MelakartaAdmin(admin.ModelAdmin):
    list_display = ("number", "name", "swara_summary")
    search_fields = ("name",)
    ordering = ("number",)
    readonly_fields = ("swara_summary",)

    @admin.display(description="Intervals")
    def swara_summary(self, obj):
        return " ".join(f"{key}:{value}" for key, value in obj.swara_intervals.items())


@admin.register(Ragam)
class RagamAdmin(admin.ModelAdmin):
    list_display = ("name", "melakarta", "arohanam", "avarohanam")
    list_filter = ("melakarta",)
    search_fields = ("name", "description", "melakarta__name")
    autocomplete_fields = ("melakarta",)
    ordering = ("melakarta__number", "name")


def _exercise_to_export_dict(exercise):
    """Serialize an exercise to a portable dict (names instead of IDs for FK refs)."""
    sections = list(exercise.sections.order_by("position", "id"))
    section_id_to_title = {s.id: s.title for s in sections}

    playback_parts = []
    for part in exercise.playback_parts.order_by("step_number", "position"):
        order_titles = [
            section_id_to_title.get(sid, "") for sid in (part.section_order or [part.section_id])
        ]
        playback_parts.append({
            "name": part.name,
            "step_number": part.step_number,
            "position": part.position,
            "section_order_titles": order_titles,
            "notes_per_beat": part.notes_per_beat,
            "repeat_count": part.repeat_count,
        })

    return {
        "_export_version": 1,
        "title": exercise.title,
        "description": exercise.description,
        "notes": exercise.notes,
        "lyrics": exercise.lyrics,
        "position": exercise.position,
        "note_duration_fixed": exercise.note_duration_fixed,
        "repeat_to_complete_talam": exercise.repeat_to_complete_talam,
        "complete_talam_with_empty_notes": exercise.complete_talam_with_empty_notes,
        "session_name": exercise.session.name,
        "talam_name": exercise.talam.name,
        "ragam_name": exercise.ragam.name if exercise.ragam else None,
        "sections": [
            {
                "title": s.title,
                "notes": s.notes,
                "lyrics": s.lyrics,
                "position": s.position,
            }
            for s in sections
        ],
        "playback_parts": playback_parts,
    }


def _import_exercise_from_dict(data):
    """
    Create a new Exercise (plus sections & playback parts) from an exported dict.
    Raises ValueError with a descriptive message if anything cannot be resolved.
    """
    version = data.get("_export_version", 0)
    if version != 1:
        raise ValueError(f"Unsupported export version: {version!r}. Expected 1.")

    # Resolve FK relations by name
    session_name = data.get("session_name", "")
    talam_name = data.get("talam_name", "")
    ragam_name = data.get("ragam_name")

    try:
        session = Session.objects.get(name=session_name)
    except Session.DoesNotExist:
        raise ValueError(f"Session '{session_name}' not found. Create it first.")
    except Session.MultipleObjectsReturned:
        raise ValueError(f"Multiple sessions named '{session_name}'. Cannot resolve automatically.")

    try:
        talam = Talam.objects.get(name=talam_name)
    except Talam.DoesNotExist:
        raise ValueError(f"Talam '{talam_name}' not found. Create it first.")

    ragam = None
    if ragam_name:
        try:
            ragam = Ragam.objects.get(name=ragam_name)
        except Ragam.DoesNotExist:
            raise ValueError(f"Ragam '{ragam_name}' not found. Create it first.")

    exercise = Exercise.objects.create(
        title=data.get("title", "Imported Exercise"),
        description=data.get("description", ""),
        notes=data.get("notes", ""),
        lyrics=data.get("lyrics", ""),
        position=data.get("position", 0),
        note_duration_fixed=data.get("note_duration_fixed", False),
        repeat_to_complete_talam=data.get("repeat_to_complete_talam", True),
        complete_talam_with_empty_notes=data.get("complete_talam_with_empty_notes", False),
        session=session,
        talam=talam,
        ragam=ragam,
    )

    # Create sections and build title→id map for playback parts
    section_title_to_id = {}
    for sec_data in data.get("sections", []):
        sec = ExerciseSection.objects.create(
            exercise=exercise,
            title=sec_data.get("title", ""),
            notes=sec_data.get("notes", ""),
            lyrics=sec_data.get("lyrics", ""),
            position=sec_data.get("position", 0),
        )
        section_title_to_id[sec.title.strip().lower()] = sec.id

    # Create playback parts
    for part_data in data.get("playback_parts", []):
        order_titles = part_data.get("section_order_titles", [])
        order_ids = []
        for title in order_titles:
            sid = section_title_to_id.get(title.strip().lower())
            if sid is None:
                raise ValueError(
                    f"Playback part references section '{title}' which does not exist in this exercise."
                )
            order_ids.append(sid)

        first_section_id = order_ids[0] if order_ids else None
        if first_section_id is None:
            continue  # skip parts with no valid section reference

        ExercisePlaybackPart.objects.create(
            exercise=exercise,
            name=part_data.get("name", ""),
            step_number=part_data.get("step_number", 1),
            position=part_data.get("position", 0),
            section_id=first_section_id,
            section_order=order_ids,
            notes_per_beat=part_data.get("notes_per_beat", 1),
            repeat_count=part_data.get("repeat_count", 1),
        )

    return exercise


@admin.register(Exercise)
class ExerciseAdmin(admin.ModelAdmin):
    list_display = ("title", "session", "talam", "ragam", "repeat_to_complete_talam", "complete_talam_with_empty_notes", "note_duration_fixed", "position")
    list_filter = ("session", "talam", "ragam", "repeat_to_complete_talam", "complete_talam_with_empty_notes", "note_duration_fixed")
    search_fields = ("title", "description", "notes", "session__name")
    autocomplete_fields = ("session", "talam", "ragam")
    exclude = ("melakarta",)
    inlines = (ExerciseSectionInline, ExercisePlaybackPartInline)
    ordering = ("session", "position", "title")

    # ------------------------------------------------------------------ #
    # Custom URLs                                                          #
    # ------------------------------------------------------------------ #
    def get_urls(self):
        custom = [
            path(
                "<int:pk>/export/",
                self.admin_site.admin_view(self.export_view),
                name="exercise-export",
            ),
            path(
                "import/",
                self.admin_site.admin_view(self.import_view),
                name="exercise-import",
            ),
        ]
        return custom + super().get_urls()

    # ------------------------------------------------------------------ #
    # Export view                                                          #
    # ------------------------------------------------------------------ #
    def export_view(self, request, pk):
        try:
            exercise = Exercise.objects.get(pk=pk)
        except Exercise.DoesNotExist:
            messages.error(request, "Exercise not found.")
            return redirect(reverse("admin:lessons_exercise_changelist"))

        payload = _exercise_to_export_dict(exercise)
        filename = f"exercise_{pk}_{exercise.title[:40].replace(' ', '_')}.json"
        response = HttpResponse(
            json.dumps(payload, indent=2, ensure_ascii=False),
            content_type="application/json",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    # ------------------------------------------------------------------ #
    # Import view                                                          #
    # ------------------------------------------------------------------ #
    def import_view(self, request):
        context = {
            **self.admin_site.each_context(request),
            "title": "Import Exercise",
            "error": None,
        }

        if request.method == "POST":
            uploaded = request.FILES.get("json_file")
            if not uploaded:
                context["error"] = "No file was uploaded."
                return render(request, "admin/lessons/exercise/import_exercise.html", context)

            try:
                raw = uploaded.read().decode("utf-8")
                data = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                context["error"] = f"Could not parse JSON file: {exc}"
                return render(request, "admin/lessons/exercise/import_exercise.html", context)

            try:
                exercise = _import_exercise_from_dict(data)
            except ValueError as exc:
                context["error"] = str(exc)
                return render(request, "admin/lessons/exercise/import_exercise.html", context)

            messages.success(
                request,
                f"Exercise '{exercise.title}' imported successfully (ID {exercise.pk}).",
            )
            return redirect(reverse("admin:lessons_exercise_change", args=[exercise.pk]))

        return render(request, "admin/lessons/exercise/import_exercise.html", context)


@admin.register(Lesson)
class LegacyLessonAdmin(admin.ModelAdmin):
    list_display = ("title", "talam_beats", "note_duration_fixed")
    search_fields = ("title", "notes")
