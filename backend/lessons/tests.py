import json
import re
import tempfile
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core import mail
from django.core.management import call_command
from django.test import Client, TestCase, override_settings

from .models import (
    ClassHomework,
    Exercise,
    HomeworkCompletion,
    MusicClass,
    PracticeRecording,
    Session,
    Talam,
    TeacherRecordingComment,
    UserProfile,
)


OWNER_KEY = UUID("83a6688e-c4d0-44d0-9db4-1ffb88297db1")


class PracticeRecordingApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        session = Session.objects.create(name="Sarali swarams")
        talam = Talam.objects.create(name="Adi Talam", beats=8)
        cls.exercise = Exercise.objects.create(
            title="Exercise 1",
            notes="S R G M",
            session=session,
            talam=talam,
        )
        User = get_user_model()
        cls.user = User.objects.create_user(
            username="practice-owner",
            email="practice-owner@example.com",
            password="Practice-owner-password-456!",
        )
        cls.other_user = User.objects.create_user(
            username="other-owner",
            email="other-owner@example.com",
            password="Other-owner-password-456!",
        )
        UserProfile.objects.create(user=cls.user, email=cls.user.email)
        UserProfile.objects.create(user=cls.other_user, email=cls.other_user.email)

    def setUp(self):
        self.media_directory = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media_directory.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(self.media_directory.cleanup)
        self.client.force_login(self.user)

    def recording_settings(self):
        return {
            "bpm": 90,
            "shruthi": "normal-G",
            "excludedPartKeys": ["part-step-2"],
            "playbackSchedule": [{"partKey": "part-step-1"}],
            "displaySchedule": [
                {"partKey": "part-step-1", "isExcluded": False},
                {"partKey": "part-step-2", "isExcluded": True},
            ],
            "totalDuration": 12,
            "exerciseTitle": "Exercise 1",
            "beats": 8,
            "cyclesPerRow": 1,
            "beatGroups": [1, 1, 1, 1, 1, 1, 1, 1],
            "beatNumbers": [0, 1, 2, 3, 0, 6, 0, 6],
            "swaraIntervals": None,
            "exerciseSnapshot": {"title": "Exercise 1", "talamName": "Adi Talam"},
            "exerciseSections": [{"title": "Main", "notes": ["S", "R"], "lyrics": []}],
        }

    def test_save_list_and_open_recording_is_owner_scoped(self):
        response = self.client.post(
            "/api/recordings/",
            {
                "exercise_id": str(self.exercise.id),
                "settings": json.dumps(self.recording_settings()),
                "audio": SimpleUploadedFile(
                    "practice-recording.webm",
                    b"practice audio",
                    content_type="audio/webm",
                ),
            },
            HTTP_X_RECORDING_OWNER=str(OWNER_KEY),
        )

        self.assertEqual(response.status_code, 201)
        recording_id = response.json()["recording"]["id"]

        listing = self.client.get(
            f"/api/recordings/?exercise_id={self.exercise.id}",
            HTTP_X_RECORDING_OWNER=str(OWNER_KEY),
        )
        self.assertEqual(listing.status_code, 200)
        saved = listing.json()["recordings"][0]
        self.assertEqual(saved["settings"]["bpm"], 90)
        self.assertEqual(saved["settings"]["excludedPartKeys"], ["part-step-2"])

        audio = self.client.get(
            f"/api/recordings/{recording_id}/audio/",
            HTTP_X_RECORDING_OWNER=str(OWNER_KEY),
        )
        self.assertEqual(audio.status_code, 200)
        self.assertEqual(b"".join(audio.streaming_content), b"practice audio")

        self.client.force_login(self.other_user)
        other_owner_listing = self.client.get(
            f"/api/recordings/?exercise_id={self.exercise.id}",
        )
        self.assertEqual(other_owner_listing.json()["recordings"], [])
        other_owner_audio = self.client.get(
            f"/api/recordings/{recording_id}/audio/",
        )
        self.assertEqual(other_owner_audio.status_code, 404)

    def test_signed_in_user_can_claim_their_legacy_browser_archive(self):
        legacy_recording = PracticeRecording.objects.create(
            owner_key=OWNER_KEY,
            exercise=self.exercise,
            exercise_title=self.exercise.title,
            audio=SimpleUploadedFile(
                "legacy-recording.webm",
                b"legacy practice audio",
                content_type="audio/webm",
            ),
            audio_content_type="audio/webm",
            settings=self.recording_settings(),
        )

        claim = self.client.post(
            "/api/recordings/claim/",
            data="{}",
            content_type="application/json",
            HTTP_X_RECORDING_OWNER=str(OWNER_KEY),
        )
        self.assertEqual(claim.status_code, 200)
        self.assertEqual(claim.json()["claimedCount"], 1)
        listing = self.client.get(f"/api/recordings/?exercise_id={self.exercise.id}")

        self.assertEqual(listing.status_code, 200)
        legacy_recording.refresh_from_db()
        self.assertEqual(legacy_recording.user, self.user)
        self.assertIsNone(legacy_recording.owner_key)
        self.assertEqual(listing.json()["recordings"][0]["id"], legacy_recording.id)

    def test_dashboard_lists_all_recordings_and_tracks_owner_scoped_listens(self):
        first_recording = PracticeRecording.objects.create(
            user=self.user,
            exercise=self.exercise,
            exercise_title=self.exercise.title,
            audio=SimpleUploadedFile(
                "first-recording.webm",
                b"first audio",
                content_type="audio/webm",
            ),
            audio_content_type="audio/webm",
            settings=self.recording_settings(),
        )
        second_recording = PracticeRecording.objects.create(
            user=self.user,
            exercise=self.exercise,
            exercise_title=self.exercise.title,
            audio=SimpleUploadedFile(
                "second-recording.webm",
                b"second audio",
                content_type="audio/webm",
            ),
            audio_content_type="audio/webm",
            settings=self.recording_settings(),
        )

        listing = self.client.get("/api/recordings/")
        self.assertEqual(listing.status_code, 200)
        recordings = listing.json()["recordings"]
        self.assertEqual(
            {item["id"] for item in recordings},
            {first_recording.id, second_recording.id},
        )
        self.assertTrue(all(item["exerciseListenCount"] == 0 for item in recordings))

        first_listen = self.client.post(
            f"/api/recordings/{first_recording.id}/listen/",
            data="{}",
            content_type="application/json",
        )
        second_listen = self.client.post(
            f"/api/recordings/{first_recording.id}/listen/",
            data="{}",
            content_type="application/json",
        )
        self.assertEqual(first_listen.status_code, 200)
        self.assertEqual(first_listen.json()["listenCount"], 1)
        self.assertEqual(second_listen.json()["listenCount"], 2)
        self.assertEqual(second_listen.json()["exerciseListenCount"], 2)

        updated_listing = self.client.get("/api/recordings/")
        self.assertTrue(
            all(item["exerciseListenCount"] == 2 for item in updated_listing.json()["recordings"])
        )

        self.client.force_login(self.other_user)
        other_user_listen = self.client.post(
            f"/api/recordings/{first_recording.id}/listen/",
            data="{}",
            content_type="application/json",
        )
        self.assertEqual(other_user_listen.status_code, 404)
        first_recording.refresh_from_db()
        self.assertEqual(first_recording.listen_count, 2)

    def test_delete_recording_removes_audio_and_is_owner_scoped(self):
        recording = PracticeRecording.objects.create(
            user=self.user,
            exercise=self.exercise,
            exercise_title=self.exercise.title,
            audio=SimpleUploadedFile(
                "delete-recording.webm",
                b"audio that should be deleted",
                content_type="audio/webm",
            ),
            audio_content_type="audio/webm",
            settings=self.recording_settings(),
        )
        audio_name = recording.audio.name
        storage = recording.audio.storage
        self.assertTrue(storage.exists(audio_name))

        self.client.force_login(self.other_user)
        not_owner = self.client.delete(f"/api/recordings/{recording.id}/")
        self.assertEqual(not_owner.status_code, 404)
        self.assertTrue(storage.exists(audio_name))
        self.assertTrue(PracticeRecording.objects.filter(id=recording.id).exists())

        self.client.force_login(self.user)
        deleted = self.client.delete(f"/api/recordings/{recording.id}/")
        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(storage.exists(audio_name))
        self.assertFalse(PracticeRecording.objects.filter(id=recording.id).exists())


class MusicClassAndHomeworkApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.admin = User.objects.create_user(
            username="class-admin",
            email="class-admin@example.com",
            password="Admin-password-123!",
        )
        cls.teacher = User.objects.create_user(
            username="class-teacher",
            email="class-teacher@example.com",
            password="Teacher-password-123!",
        )
        cls.other_teacher = User.objects.create_user(
            username="other-teacher",
            email="other-teacher@example.com",
            password="Other-teacher-password-123!",
        )
        cls.student = User.objects.create_user(
            username="class-student",
            email="class-student@example.com",
            password="Student-password-123!",
        )
        cls.other_student = User.objects.create_user(
            username="other-student",
            email="other-student@example.com",
            password="Other-student-password-123!",
        )
        for user, role in (
            (cls.admin, UserProfile.Role.ADMIN),
            (cls.teacher, UserProfile.Role.TEACHER),
            (cls.other_teacher, UserProfile.Role.TEACHER),
            (cls.student, UserProfile.Role.STUDENT),
            (cls.other_student, UserProfile.Role.STUDENT),
        ):
            UserProfile.objects.create(user=user, email=user.email, role=role)
        session = Session.objects.create(name="Class recordings")
        talam = Talam.objects.create(name="Class Talam", beats=8)
        cls.exercise = Exercise.objects.create(
            title="Class Exercise",
            notes="S R G M",
            session=session,
            talam=talam,
        )

    def setUp(self):
        self.client = Client()

    def test_admin_creates_class_and_class_membership_is_scoped(self):
        self.client.force_login(self.admin)
        response = self.client.post(
            "/api/music-classes/",
            data=json.dumps({
                "name": "Tuesday Class",
                "teacherId": self.teacher.id,
                "studentIds": [self.student.id],
            }),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        music_class = MusicClass.objects.get(name="Tuesday Class")
        self.assertEqual(music_class.teacher, self.teacher)
        self.assertEqual(list(music_class.students.all()), [self.student])
        self.assertEqual(response.json()["class"]["students"][0]["email"], self.student.email)

        self.client.force_login(self.teacher)
        teacher_classes = self.client.get("/api/music-classes/")
        self.assertEqual(
            [item["id"] for item in teacher_classes.json()["classes"]],
            [music_class.id],
        )
        self.client.force_login(self.other_student)
        self.assertEqual(self.client.get("/api/music-classes/").json()["classes"], [])

    def test_only_admin_can_create_classes_and_invalid_members_are_rejected(self):
        self.client.force_login(self.teacher)
        denied = self.client.post(
            "/api/music-classes/",
            data=json.dumps({
                "name": "Invalid Class",
                "teacherId": self.teacher.id,
                "studentIds": [self.student.id],
            }),
            content_type="application/json",
        )
        self.assertEqual(denied.status_code, 403)

        self.client.force_login(self.admin)
        invalid_teacher = self.client.post(
            "/api/music-classes/",
            data=json.dumps({
                "name": "Invalid Class",
                "teacherId": self.student.id,
                "studentIds": [self.other_teacher.id],
            }),
            content_type="application/json",
        )
        self.assertEqual(invalid_teacher.status_code, 400)
        self.assertFalse(MusicClass.objects.exists())

    def test_teacher_assigns_homework_and_student_submits_note(self):
        music_class = MusicClass.objects.create(
            name="Homework Class",
            teacher=self.teacher,
            created_by=self.admin,
        )
        music_class.students.add(self.student)
        homework_payload = {
            "classId": music_class.id,
            "title": "Practice arohanam",
            "description": "Play it five times.",
            "dueDate": "2026-12-01",
        }

        self.client.force_login(self.student)
        self.assertEqual(
            self.client.post(
                "/api/homeworks/",
                data=json.dumps(homework_payload),
                content_type="application/json",
            ).status_code,
            403,
        )

        self.client.force_login(self.teacher)
        created = self.client.post(
            "/api/homeworks/",
            data=json.dumps(homework_payload),
            content_type="application/json",
        )
        self.assertEqual(created.status_code, 201)
        homework_id = created.json()["homework"]["id"]
        self.assertEqual(created.json()["homework"]["dueDate"], "2026-12-01")

        self.client.force_login(self.student)
        student_homework = self.client.get("/api/homeworks/").json()["homeworks"]
        self.assertEqual(len(student_homework), 1)
        self.assertFalse(student_homework[0]["completed"])
        completed_without_note = self.client.patch(
            f"/api/homeworks/{homework_id}/completion/",
            data=json.dumps({"completed": True, "note": "  "}),
            content_type="application/json",
        )
        self.assertEqual(completed_without_note.status_code, 400)

        completion_response = self.client.patch(
            f"/api/homeworks/{homework_id}/completion/",
            data=json.dumps({"completed": True, "note": "Practiced five times."}),
            content_type="application/json",
        )
        self.assertEqual(completion_response.status_code, 200)
        self.assertTrue(completion_response.json()["homework"]["completed"])
        self.assertEqual(
            completion_response.json()["homework"]["completionNote"],
            "Practiced five times.",
        )
        self.assertEqual(HomeworkCompletion.objects.count(), 1)

        self.client.force_login(self.teacher)
        teacher_homework = self.client.get("/api/homeworks/").json()["homeworks"]
        self.assertEqual(teacher_homework[0]["completions"][0]["student"]["id"], self.student.id)
        self.assertEqual(teacher_homework[0]["completions"][0]["note"], "Practiced five times.")

        self.client.force_login(self.other_student)
        self.assertEqual(
            self.client.patch(
                f"/api/homeworks/{homework_id}/completion/",
                data=json.dumps({"completed": True, "note": "Not my class"}),
                content_type="application/json",
            ).status_code,
            404,
        )

    def test_teacher_can_list_and_play_only_recordings_from_assigned_classes(self):
        music_class = MusicClass.objects.create(
            name="Recording Class",
            teacher=self.teacher,
            created_by=self.admin,
        )
        music_class.students.add(self.student)
        recording = PracticeRecording.objects.create(
            user=self.student,
            exercise=self.exercise,
            exercise_title=self.exercise.title,
            audio=SimpleUploadedFile(
                "class-recording.webm",
                b"student audio",
                content_type="audio/webm",
            ),
            audio_content_type="audio/webm",
            settings={"bpm": 80, "shruthi": "normal-G"},
        )

        self.client.force_login(self.teacher)
        listing = self.client.get(f"/api/recordings/?class_id={music_class.id}")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["recordings"][0]["studentName"], self.student.email)
        audio = self.client.get(f"/api/recordings/{recording.id}/audio/")
        self.assertEqual(audio.status_code, 200)
        self.assertEqual(b"".join(audio.streaming_content), b"student audio")

        self.client.force_login(self.other_teacher)
        self.assertEqual(
            self.client.get(f"/api/recordings/?class_id={music_class.id}").status_code,
            404,
        )
        self.assertEqual(
            self.client.get(f"/api/recordings/{recording.id}/audio/").status_code,
            404,
        )

    def test_teacher_rating_is_saved_and_shown_with_recording_comment_count(self):
        music_class = MusicClass.objects.create(
            name="Rating Class",
            teacher=self.teacher,
            created_by=self.admin,
        )
        music_class.students.add(self.student)
        recording = PracticeRecording.objects.create(
            user=self.student,
            exercise=self.exercise,
            exercise_title=self.exercise.title,
            audio=SimpleUploadedFile(
                "rated-recording.webm",
                b"student audio",
                content_type="audio/webm",
            ),
            audio_content_type="audio/webm",
            settings={"bpm": 80, "shruthi": "normal-G"},
        )
        TeacherRecordingComment.objects.create(
            recording=recording,
            teacher=self.teacher,
            scope=TeacherRecordingComment.Scope.TABLE,
            table_index=0,
            comment="Good timing.",
        )

        self.client.force_login(self.student)
        student_listing = self.client.get("/api/recordings/")
        student_recording = student_listing.json()["recordings"][0]
        self.assertEqual(student_recording["sessionName"], "Class recordings")
        self.assertIsNone(student_recording["teacherRating"])
        self.assertEqual(student_recording["teacherCommentCount"], 1)
        denied_rating = self.client.patch(
            f"/api/recordings/{recording.id}/rating/",
            data=json.dumps({"rating": 85}),
            content_type="application/json",
        )
        self.assertEqual(denied_rating.status_code, 403)

        self.client.force_login(self.teacher)
        endpoint = f"/api/recordings/{recording.id}/rating/"
        for invalid_rating in (-1, 101, 80.5, True, "85"):
            invalid = self.client.patch(
                endpoint,
                data=json.dumps({"rating": invalid_rating}),
                content_type="application/json",
            )
            self.assertEqual(invalid.status_code, 400)

        saved = self.client.patch(
            endpoint,
            data=json.dumps({"rating": 85}),
            content_type="application/json",
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["teacherRating"], 85)

        teacher_listing = self.client.get(f"/api/recordings/?class_id={music_class.id}")
        teacher_recording = teacher_listing.json()["recordings"][0]
        self.assertEqual(teacher_recording["sessionName"], "Class recordings")
        self.assertEqual(teacher_recording["teacherRating"], 85)
        self.assertEqual(teacher_recording["teacherCommentCount"], 1)

        self.client.force_login(self.student)
        student_listing = self.client.get("/api/recordings/")
        student_recording = student_listing.json()["recordings"][0]
        self.assertEqual(student_recording["teacherRating"], 85)
        self.assertEqual(student_recording["teacherCommentCount"], 1)

    def test_teacher_comments_are_saved_by_table_row_or_note_and_student_can_read_them(self):
        music_class = MusicClass.objects.create(
            name="Comments Class",
            teacher=self.teacher,
            created_by=self.admin,
        )
        music_class.students.add(self.student)
        settings_payload = {
            "bpm": 80,
            "shruthi": "normal-G",
            "displaySchedule": [{
                "partKey": "part-1",
                "sectionIndex": 0,
                "section": {"title": "Arohanam"},
                "notes": ["S", "R", "G", "M"],
                "beats": 2,
                "notesPerBeat": 1,
                "cyclesPerRow": 1,
                "repeatToCompleteTalam": False,
                "completeTalamWithEmptyNotes": False,
            }],
        }
        recording = PracticeRecording.objects.create(
            user=self.student,
            exercise=self.exercise,
            exercise_title=self.exercise.title,
            audio=SimpleUploadedFile(
                "comment-recording.webm",
                b"student audio",
                content_type="audio/webm",
            ),
            audio_content_type="audio/webm",
            settings=settings_payload,
        )
        endpoint = f"/api/recordings/{recording.id}/comments/"

        self.client.force_login(self.other_teacher)
        denied_list = self.client.get(endpoint)
        self.assertEqual(denied_list.status_code, 404)
        denied_write = self.client.post(
            endpoint,
            data=json.dumps({
                "scope": "table",
                "tableIndex": 0,
                "comment": "Not my student",
            }),
            content_type="application/json",
        )
        self.assertEqual(denied_write.status_code, 404)

        self.client.force_login(self.teacher)
        comment_payloads = [
            {"scope": "table", "tableIndex": 0, "comment": "Good overall phrasing."},
            {
                "scope": "row",
                "tableIndex": 0,
                "rowIndex": 1,
                "comment": "Keep the rhythm steady here.",
            },
            {
                "scope": "note",
                "tableIndex": 0,
                "rowIndex": 1,
                "noteIndex": 0,
                "comment": "Tune this R more carefully.",
            },
        ]
        created = []
        for payload in comment_payloads:
            response = self.client.post(
                endpoint,
                data=json.dumps(payload),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 201)
            created.append(response.json()["comment"])
        self.assertEqual(
            [comment["scope"] for comment in created],
            ["table", "row", "note"],
        )
        self.assertEqual(TeacherRecordingComment.objects.count(), 3)
        self.assertTrue(created[0]["canEdit"])

        other_class = MusicClass.objects.create(
            name="Second Comments Class",
            teacher=self.other_teacher,
            created_by=self.admin,
        )
        other_class.students.add(self.student)
        self.client.force_login(self.other_teacher)
        cannot_edit_another_teachers_comment = self.client.patch(
            f"{endpoint}{created[0]['id']}/",
            data=json.dumps({"comment": "Changed by another teacher."}),
            content_type="application/json",
        )
        self.assertEqual(cannot_edit_another_teachers_comment.status_code, 403)
        cannot_delete_another_teachers_comment = self.client.delete(
            f"{endpoint}{created[0]['id']}/",
        )
        self.assertEqual(cannot_delete_another_teachers_comment.status_code, 403)

        self.client.force_login(self.teacher)
        edited = self.client.patch(
            f"{endpoint}{created[0]['id']}/",
            data=json.dumps({"comment": "Updated overall feedback."}),
            content_type="application/json",
        )
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()["comment"]["comment"], "Updated overall feedback.")
        deleted = self.client.delete(f"{endpoint}{created[1]['id']}/")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(TeacherRecordingComment.objects.count(), 2)

        self.client.force_login(self.student)
        listing = self.client.get(endpoint)
        self.assertEqual(listing.status_code, 200)
        comments = listing.json()["comments"]
        self.assertEqual(len(comments), 2)
        self.assertEqual(comments[0]["teacherName"], self.teacher.email)
        self.assertEqual(comments[0]["comment"], "Updated overall feedback.")
        self.assertFalse(comments[0]["canEdit"])
        self.assertEqual(comments[1]["noteIndex"], 0)
        forbidden_write = self.client.post(
            endpoint,
            data=json.dumps(comment_payloads[0]),
            content_type="application/json",
        )
        self.assertEqual(forbidden_write.status_code, 403)
        forbidden_edit = self.client.patch(
            f"{endpoint}{comments[0]['id']}/",
            data=json.dumps({"comment": "Student changed the comment."}),
            content_type="application/json",
        )
        self.assertEqual(forbidden_edit.status_code, 403)
        forbidden_delete = self.client.delete(f"{endpoint}{comments[0]['id']}/")
        self.assertEqual(forbidden_delete.status_code, 403)
        self.assertEqual(TeacherRecordingComment.objects.count(), 2)

    def test_comment_endpoint_rejects_invalid_recording_anchors(self):
        music_class = MusicClass.objects.create(
            name="Anchor Validation Class",
            teacher=self.teacher,
            created_by=self.admin,
        )
        music_class.students.add(self.student)
        recording = PracticeRecording.objects.create(
            user=self.student,
            exercise=self.exercise,
            exercise_title=self.exercise.title,
            audio=SimpleUploadedFile(
                "anchor-recording.webm",
                b"student audio",
                content_type="audio/webm",
            ),
            audio_content_type="audio/webm",
            settings={"displaySchedule": [{"notes": ["S"]}]},
        )
        self.client.force_login(self.teacher)
        invalid = self.client.post(
            f"/api/recordings/{recording.id}/comments/",
            data=json.dumps({
                "scope": "note",
                "tableIndex": 1,
                "rowIndex": 0,
                "noteIndex": 0,
                "comment": "Invalid table anchor.",
            }),
            content_type="application/json",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(TeacherRecordingComment.objects.exists())


@override_settings(CSRF_TRUSTED_ORIGINS=["http://localhost:5174"])
class AccountApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)

    def csrf_headers(self):
        self.client.get("/api/auth/csrf/")
        return {
            "HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value,
            "HTTP_ORIGIN": "http://localhost:5174",
        }

    def registration_payload(self):
        return {
            "email": "Student@Example.com",
            "firstName": "Anu",
            "surname": "Rao",
            "parentName": "Mira Rao",
            "musicTeacherName": "Lakshmi",
            "contactNumber": "+441234567890",
            "address": "London",
            "learningMode": "vocal",
            "instrumentName": "",
            "defaultShruthi": "normal-D",
            "password": "A-unique-password-920!",
            "passwordConfirm": "A-unique-password-920!",
        }

    def test_registration_creates_student_and_enforces_unique_email_case_insensitively(self):
        without_csrf = self.client.post(
            "/api/auth/register/",
            data=json.dumps(self.registration_payload()),
            content_type="application/json",
            HTTP_ORIGIN="http://localhost:5174",
        )
        self.assertEqual(without_csrf.status_code, 403)

        response = self.client.post(
            "/api/auth/register/",
            data=json.dumps(self.registration_payload()),
            content_type="application/json",
            **self.csrf_headers(),
        )
        self.assertEqual(response.status_code, 201)
        user = get_user_model().objects.get(email="student@example.com")
        self.assertTrue(user.is_active)
        self.assertEqual(user.first_name, "Anu")
        self.assertEqual(user.last_name, "Rao")
        self.assertEqual(user.profile.role, UserProfile.Role.STUDENT)
        self.assertEqual(user.profile.parent_name, "Mira Rao")
        self.assertEqual(user.profile.learning_mode, UserProfile.LearningMode.VOCAL)
        self.assertEqual(user.profile.default_shruthi, "normal-D")
        self.assertEqual(user.profile.instrument_name, "")
        self.assertEqual(self.client.get("/api/auth/me/").json()["user"]["email"], user.email)

        duplicate = self.client.post(
            "/api/auth/register/",
            data=json.dumps({**self.registration_payload(), "email": "STUDENT@example.com"}),
            content_type="application/json",
            **self.csrf_headers(),
        )
        self.assertEqual(duplicate.status_code, 400)
        self.assertEqual(get_user_model().objects.filter(profile__email__iexact=user.email).count(), 1)

    def test_user_can_login_update_details_and_sign_out(self):
        user = get_user_model().objects.create_user(
            username="registered-user",
            email="user@example.com",
            password="A-unique-password-920!",
        )
        UserProfile.objects.create(user=user, email=user.email)
        response = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"email": "USER@example.com", "password": "A-unique-password-920!"}),
            content_type="application/json",
            **self.csrf_headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["email"], "user@example.com")

        update = self.client.patch(
            "/api/auth/profile/",
            data=json.dumps({
                "email": "new@example.com",
                "firstName": "New",
                "surname": "Name",
                "parentName": "Parent",
                "musicTeacherName": "Teacher",
                "contactNumber": "+44111",
                "address": "New address",
                "learningMode": "instrument",
                "instrumentName": "Veena",
                "defaultShruthi": "higher-C#",
            }),
            content_type="application/json",
            **self.csrf_headers(),
        )
        self.assertEqual(update.status_code, 200)
        user.refresh_from_db()
        self.assertEqual(user.email, "user@example.com")
        self.assertEqual(user.profile.email, "user@example.com")
        self.assertEqual(user.profile.learning_mode, UserProfile.LearningMode.INSTRUMENT)
        self.assertEqual(user.profile.music_teacher_name, "Teacher")
        self.assertEqual(user.email, "user@example.com")
        self.assertEqual(user.profile.instrument_name, "Veena")
        self.assertEqual(user.profile.default_shruthi, "higher-C#")

        missing_instrument = self.client.patch(
            "/api/auth/profile/",
            data=json.dumps({
                "firstName": "New",
                "surname": "Name",
                "learningMode": "instrument",
                "instrumentName": "",
                "defaultShruthi": "normal-G",
            }),
            content_type="application/json",
            **self.csrf_headers(),
        )
        self.assertEqual(missing_instrument.status_code, 400)
        self.assertEqual(missing_instrument.json()["error"], "Enter the instrument name.")

        sign_out = self.client.post(
            "/api/auth/logout/",
            data="{}",
            content_type="application/json",
            **self.csrf_headers(),
        )
        self.assertEqual(sign_out.status_code, 200)
        self.assertIsNone(self.client.get("/api/auth/me/").json()["user"])

        other_user = get_user_model().objects.create_user(
            username="second-user",
            email="second@example.com",
            password="Second-user-password-456!",
        )
        UserProfile.objects.create(user=other_user, email=other_user.email)
        second_login = self.client.post(
            "/api/auth/login/",
            data=json.dumps({
                "email": "second@example.com",
                "password": "Second-user-password-456!",
            }),
            content_type="application/json",
            **self.csrf_headers(),
        )
        self.assertEqual(second_login.status_code, 200)
        self.assertEqual(
            self.client.get("/api/auth/me/").json()["user"]["email"],
            "second@example.com",
        )

    def test_csrf_endpoint_returns_a_token_and_invalid_token_gets_json_error(self):
        response = self.client.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["csrfToken"])

        rejected = self.client.post(
            "/api/auth/logout/",
            data="{}",
            content_type="application/json",
            HTTP_X_CSRFTOKEN="stale-token",
            HTTP_ORIGIN="http://localhost:5174",
        )
        self.assertEqual(rejected.status_code, 403)
        self.assertEqual(rejected["Content-Type"], "application/json")
        self.assertIn("Security check failed", rejected.json()["error"])

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        FRONTEND_BASE_URL="https://sunaadam.example",
    )
    def test_password_reset_email_and_confirmed_token_change_password(self):
        user = get_user_model().objects.create_user(
            username="reset-user",
            email="reset@example.com",
            password="Original-password-123!",
        )
        UserProfile.objects.create(user=user, email=user.email)
        response = self.client.post(
            "/api/auth/password-reset/",
            data=json.dumps({"email": user.email}),
            content_type="application/json",
            **self.csrf_headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

        match = re.search(r"\?uid=([^&\s]+)&token=([^\s]+)", mail.outbox[0].body)
        self.assertIsNotNone(match)
        reset = self.client.post(
            "/api/auth/password-reset/confirm/",
            data=json.dumps({
                "uid": match.group(1),
                "token": match.group(2),
                "password": "Replacement-password-123!",
            }),
            content_type="application/json",
            **self.csrf_headers(),
        )
        self.assertEqual(reset.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password("Replacement-password-123!"))

    def test_seed_users_creates_admin_teacher_and_student_idempotently(self):
        call_command("seed_users", verbosity=0)

        User = get_user_model()
        expected = (
            ("admin@example.com", "admin", UserProfile.Role.ADMIN),
            ("teacher@example.com", "teacher", UserProfile.Role.TEACHER),
            ("student@example.com", "student", UserProfile.Role.STUDENT),
        )
        for email, password, role in expected:
            with self.subTest(email=email):
                user = User.objects.get(profile__email=email)
                self.assertTrue(user.check_password(password))
                self.assertEqual(user.profile.role, role)

        admin_user = User.objects.get(profile__email="admin@example.com")
        self.assertTrue(admin_user.is_superuser)
        seeded_user_count = User.objects.count()

        call_command("seed_users", verbosity=0)

        self.assertEqual(User.objects.count(), seeded_user_count)
        self.assertTrue(User.objects.get(profile__email="teacher@example.com").check_password("teacher"))
