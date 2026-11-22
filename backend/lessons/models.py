from django.core.exceptions import ValidationError
from django.db import models


class Session(models.Model):
    name = models.CharField(max_length=120)
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        related_name="children",
        on_delete=models.CASCADE,
    )
    allow_ragam_change = models.BooleanField(
        default=False,
        help_text="Allow users to select/change the ragam for exercises in this session.",
    )
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name

    def as_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "parentId": self.parent_id,
            "allowRagamChange": self.allow_ragam_change,
        }


class Talam(models.Model):
    name = models.CharField(max_length=120, unique=True)
    beats = models.PositiveIntegerField(default=8)
    cycles_per_row = models.PositiveIntegerField(default=1)
    beat_groups = models.CharField(
        max_length=128,
        default="1,1,1,1,1,1,1,1",
        help_text="Comma-separated beat counts per displayed column. Must add up to the total beats.",
    )
    beat_numbers = models.CharField(
        max_length=128,
        default="0,1,2,3,0,6,0,6",
        help_text="Comma-separated numbers, one per beat. Allowed values: 0 to 6.",
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.beats} beats)"

    def beat_number_list(self):
        values = [value.strip() for value in self.beat_numbers.split(",") if value.strip()]
        if len(values) != self.beats:
            raise ValidationError({"beat_numbers": f"Enter exactly {self.beats} comma-separated values."})
        if any(value not in {"0", "1", "2", "3", "4", "5", "6"} for value in values):
            raise ValidationError({"beat_numbers": "Every beat number must be between 0 and 6."})
        return [int(value) for value in values]

    def beat_group_list(self):
        values = [value.strip() for value in self.beat_groups.split(",") if value.strip()]
        try:
            groups = [int(value) for value in values]
        except ValueError as error:
            raise ValidationError({"beat_groups": "Every beat group must be a whole number."}) from error
        if not groups or any(group < 1 for group in groups) or sum(groups) != self.beats:
            raise ValidationError({"beat_groups": f"Enter positive groups that add up to {self.beats} beats."})
        return groups

    def clean(self):
        super().clean()
        self.beat_number_list()
        self.beat_group_list()

    def as_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "beats": self.beats,
            "cyclesPerRow": self.cycles_per_row,
            "beatGroups": self.beat_group_list(),
            "beatNumbers": self.beat_number_list(),
        }


class Melakarta(models.Model):
    number = models.PositiveSmallIntegerField(unique=True)
    name = models.CharField(max_length=120, unique=True)
    swara_intervals = models.JSONField(
        default=dict,
        help_text='JSON semitone map, for example {"S":0,"R":2,"G":4,"M":5,"P":7,"D":9,"N":11}.',
    )

    class Meta:
        ordering = ["number"]
        verbose_name = "Melakarta raga"
        verbose_name_plural = "Melakarta ragas"

    def __str__(self):
        return f"{self.number}. {self.name}"

    def clean(self):
        super().clean()
        required = {"S", "R", "G", "M", "P", "D", "N"}
        if set(self.swara_intervals) != required:
            raise ValidationError({"swara_intervals": "Enter exactly S, R, G, M, P, D and N."})
        if any(
            not isinstance(value, int) or value < 0 or value > 11
            for value in self.swara_intervals.values()
        ):
            raise ValidationError({"swara_intervals": "Every interval must be an integer from 0 to 11."})

    def as_dict(self):
        return {
            "id": self.id,
            "number": self.number,
            "name": self.name,
            "swaraIntervals": self.swara_intervals,
        }


class Ragam(models.Model):
    name = models.CharField(max_length=120, unique=True)
    melakarta = models.ForeignKey(Melakarta, related_name="ragams", on_delete=models.PROTECT)
    arohanam = models.TextField(default="S R G M P D N S+")
    avarohanam = models.TextField(default="S+ N D P M G R S")
    description = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["melakarta__number", "name"]

    def __str__(self):
        return self.name

    def is_melakarta(self):
        return bool(
            self.melakarta and self.name.strip().lower() == self.melakarta.name.strip().lower()
        )

    def as_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "melakartaId": self.melakarta_id,
            "melakartaName": self.melakarta.name,
            "melakartaNumber": self.melakarta.number,
            "isMelakarta": self.is_melakarta(),
            "arohanam": self.arohanam,
            "avarohanam": self.avarohanam,
            "description": self.description,
            "swaraIntervals": self.melakarta.swara_intervals,
        }


class Exercise(models.Model):
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    notes = models.TextField()
    lyrics = models.TextField(blank=True, default="")
    session = models.ForeignKey(Session, related_name="exercises", on_delete=models.CASCADE)
    talam = models.ForeignKey(Talam, related_name="exercises", on_delete=models.PROTECT)
    melakarta = models.ForeignKey(
        Melakarta,
        related_name="exercises",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
    )
    ragam = models.ForeignKey(
        Ragam,
        related_name="exercises",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
    )
    note_duration_fixed = models.BooleanField(default=False)
    repeat_to_complete_talam = models.BooleanField(
        default=True,
        help_text="Repeat notes until duration aligns with a complete Talam cycle.",
    )
    complete_talam_with_empty_notes = models.BooleanField(
        default=False,
        help_text="When repetition is disabled, fill the uncompleted final Talam row with empty notes (;).",
    )
    position = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.session} · {self.title}"

    def as_dict(self):
        playback_parts = list(self.playback_parts.all())
        if playback_parts:
            grouped_steps = {}
            for part in playback_parts:
                step = grouped_steps.setdefault(
                    part.step_number,
                    {
                        "id": f"part-step-{part.step_number}",
                        "name": part.name,
                        "sectionIds": [],
                        "notesPerBeat": part.notes_per_beat,
                        "repeatCount": part.repeat_count,
                        "position": part.step_number,
                    },
                )
                step["sectionIds"].extend(part.section_order or [part.section_id])
            playback_sequence = list(grouped_steps.values())
        else:
            playback_sequence = [step.as_dict() for step in self.playback_sequence.all()]
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "notes": self.notes,
            "lyrics": self.lyrics,
            "sessionId": self.session_id,
            "talamId": self.talam_id,
            "talamBeats": self.talam.beats,
            "talamName": self.talam.name,
            "melakartaId": self.melakarta_id or (self.ragam.melakarta_id if self.ragam else None),
            "melakartaName": self.melakarta.name if self.melakarta else (
                self.ragam.melakarta.name if self.ragam else ""
            ),
            "melakartaNumber": (
                self.melakarta.number if self.melakarta
                else self.ragam.melakarta.number if self.ragam
                else None
            ),
            "ragamId": self.ragam_id,
            "ragamName": self.ragam.name if self.ragam else "",
            "ragamArohanam": self.ragam.arohanam if self.ragam else "",
            "ragamAvarohanam": self.ragam.avarohanam if self.ragam else "",
            "ragamDescription": self.ragam.description if self.ragam else "",
            "swaraIntervals": (
                self.ragam.melakarta.swara_intervals if self.ragam
                else self.melakarta.swara_intervals if self.melakarta
                else None
            ),
            "sections": [section.as_dict() for section in self.sections.all()],
            "playbackSequence": playback_sequence,
            "noteDurationFixed": self.note_duration_fixed,            
            "repeatToCompleteTalam": self.repeat_to_complete_talam,
            "completeTalamWithEmptyNotes": self.complete_talam_with_empty_notes,
            "allowRagamChange": (
                self.session.allow_ragam_change or (
                    self.session.parent.allow_ragam_change if self.session.parent else False
                )
            ) if self.session else False,
        }


class ExerciseSection(models.Model):
    exercise = models.ForeignKey(Exercise, related_name="sections", on_delete=models.CASCADE)
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    notes = models.TextField()
    lyrics = models.TextField(blank=True, default="")
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.exercise.title} · {self.title}"

    def as_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "notes": self.notes,
            "lyrics": self.lyrics,
            "position": self.position,
        }


class ExercisePlaybackStep(models.Model):
    exercise = models.ForeignKey(Exercise, related_name="playback_sequence", on_delete=models.CASCADE)
    section = models.ForeignKey(
        ExerciseSection,
        related_name="legacy_playback_steps",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    sections = models.ManyToManyField(
        ExerciseSection,
        related_name="playback_steps",
        blank=True,
    )
    notes_per_beat = models.PositiveSmallIntegerField(default=1)
    repeat_count = models.PositiveSmallIntegerField(default=1)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.exercise.title} · {self.section.title} · {self.notes_per_beat} per beat"

    def clean(self):
        super().clean()
        if self.notes_per_beat not in {1, 2, 3, 4}:
            raise ValidationError({"notes_per_beat": "Choose 1, 2, 3 or 4 notes per beat."})
        if self.repeat_count < 1:
            raise ValidationError({"repeat_count": "Repeat count must be at least 1."})
        if self.section_id and self.exercise_id and self.section.exercise_id != self.exercise_id:
            raise ValidationError({"section": "The section must belong to this exercise."})

    def as_dict(self):
        return {
            "id": self.id,
            "sectionId": self.section_id,
            "sectionIds": list(self.sections.values_list("id", flat=True)) or (
                [self.section_id] if self.section_id else []
            ),
            "notesPerBeat": self.notes_per_beat,
            "repeatCount": self.repeat_count,
            "position": self.position,
        }


class ExercisePlaybackPart(models.Model):
    exercise = models.ForeignKey(Exercise, related_name="playback_parts", on_delete=models.CASCADE)
    name = models.CharField(max_length=120, blank=True, default="")
    step_number = models.PositiveIntegerField(default=1)
    position = models.PositiveIntegerField(default=0)
    section = models.ForeignKey(ExerciseSection, on_delete=models.CASCADE)
    section_order = models.JSONField(default=list, blank=True)
    notes_per_beat = models.PositiveSmallIntegerField(default=1)
    repeat_count = models.PositiveSmallIntegerField(default=1)

    class Meta:
        ordering = ["step_number", "position", "id"]

    def __str__(self):
        return f"{self.exercise.title} · Step {self.step_number} · {self.section.title}"

    def clean(self):
        super().clean()
        if self.notes_per_beat not in {1, 2, 3, 4}:
            raise ValidationError({"notes_per_beat": "Choose 1, 2, 3 or 4 notes per beat."})
        if self.repeat_count < 1:
            raise ValidationError({"repeat_count": "Repeat count must be at least 1."})
        if self.section_id and self.exercise_id and self.section.exercise_id != self.exercise_id:
            raise ValidationError({"section": "The section must belong to this exercise."})


class Lesson(models.Model):
    """Legacy table retained so existing installations can migrate safely."""

    title = models.CharField(max_length=120)
    notes = models.TextField()
    talam_beats = models.PositiveIntegerField(default=8)
    note_duration_fixed = models.BooleanField(default=False)
    position = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "id"]

    def as_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "notes": self.notes,
            "talamBeats": self.talam_beats,
            "noteDurationFixed": self.note_duration_fixed,
        }
