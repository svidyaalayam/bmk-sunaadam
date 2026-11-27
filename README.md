# BMK Sunaadam

A Carnatic music learning app with a React/Vite frontend, Django API, and PostgreSQL
storage for sessions, exercises, talams, and ragams.

## Run with Docker

1. Start Docker Desktop and wait until its engine is running.
2. From this folder, copy `.env.example` to `.env` and change the secrets.
3. Build and start the stack:

```powershell
docker compose up -d --build
```

Open:

- http://localhost:5174/ — Carnatic notes
- http://localhost:5174/admin/ — Django Admin
- http://localhost:8002/api/curriculum/ — Django API

The backend is published on host port `8002` by default to avoid conflicts with
other local services. Set `BACKEND_PORT` in `.env` if that port is also in use;
the container continues to listen on port `8000` internally.

The Carnatic page loads its sessions, exercises, and Talams from Django and
PostgreSQL. Manage them from Django Admin:

- Create top-level sessions with no parent.
- Create child sessions by selecting a parent session.
- Create Talams with their beat count.
- Create exercises and link each one to a session and Talam.

When running the frontend with Vite on port 5173, its API proxy defaults to
`http://localhost:8002`, the backend port published by Docker Compose. Override
`VITE_API_PROXY_TARGET` if `BACKEND_PORT` differs; for example, in PowerShell
use `$env:VITE_API_PROXY_TARGET="http://localhost:8003"` before starting Vite
if you have set `BACKEND_PORT=8003`.

The default seeded accounts are:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `admin` |
| Teacher | `teacher@example.com` | `teacher` |
| Student | `student@example.com` | `student` |

Change these passwords in `.env` before deployment using
`DJANGO_ADMIN_PASSWORD`, `DJANGO_TEACHER_PASSWORD`, and
`DJANGO_STUDENT_PASSWORD`. The seed command creates missing accounts and does
not reset passwords for accounts that already exist.

## User accounts

Users can register with a unique email address, sign in from the top-right
account menu, update their profile, and request a password reset. New accounts
are active immediately and receive the **Student** role. Profile details include
first name, surname, parent's name, music teacher, contact number, address, and
whether they study vocal or an instrument.

Manage roles from **Django Admin → Users** using the profile section:

- **Student** — the default for registrations.
- **Teacher**
- **Admin**

The role is an application profile value. Django Admin access remains controlled
by Django's `is_staff` and permissions; changing a user's profile role alone does
not grant access to the Django Admin site.

Password reset links are sent by email. Set `FRONTEND_BASE_URL` to the public
site URL and configure `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`,
`EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, and `DEFAULT_FROM_EMAIL` in `.env`.
The example `.env` uses Django's console email backend so reset links appear in
the backend logs during local development. For deployment, use
`EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend` and configure valid
SMTP credentials.
For an HTTPS deployment, set `SESSION_COOKIE_SECURE=1` and
`CSRF_COOKIE_SECURE=1`; the example `.env` uses `0` for local HTTP.
`CSRF_TRUSTED_ORIGINS` must include the exact browser origin used to open the
site (the defaults cover `localhost:5174` and `127.0.0.1:5174`). Set it to a
comma-separated list of scheme-and-host origins for a custom hostname or port.

Useful commands:

```powershell
docker compose logs -f backend
docker compose ps
docker compose down
```

The PostgreSQL data is kept in the `postgres_data` Docker volume.

## Practice recordings

After recording an exercise, select **Save recording** to store its audio and
exercise snapshot (BPM, shruthi, excluded parts, Talam, and playback schedule).
Saved recordings appear under the selected exercise and can be reopened for
synchronized playback. The backend stores metadata in PostgreSQL and audio in
the Docker `practice_recordings` named volume mounted at `/app/media`; back up
both that volume and `postgres_data`.

Signed-in users can open **Dashboard** from the account menu to view all of
their saved recordings, replay a recording with its saved note annotations,
review listen counts by recording and exercise, and select **Analyze
performance** for note-by-note pitch feedback. Analysis compares the recording
to the saved shruthi and note schedule; matching pitch classes count as correct
even when sung or played in a different octave. Environmental noise and gamaka
can affect results. In-browser analysis is limited to 25 MB and 10 minutes per
recording. Results are shown on the animated notes as green ticks and red
crosses, with detected pitch details on hover. Use **Select From** and
**Select To** to click a note in the animated table, or choose notes from the
dropdowns, to replay only that passage with synchronized note animation.
Recordings can be permanently deleted from the dashboard, including their
stored audio file. A listen is counted when the saved audio reaches its end.

## Music classes and homework

Admins can create music classes from the dashboard and assign each class one
teacher and one or more student accounts. Teachers can view and play recordings
from their assigned classes, set class-wide targets/homework (including optional
instructions and due dates), and review each student's completion status and
note. Students see homework for their classes and submit a note when marking an
assignment complete. Class membership and recording access are enforced by the
backend; teachers can only access students in their own classes.
Teachers can also leave persistent comments on a student's recording at the
whole-table, row, or individual-note level. Students see those comments when
they open the recording; the teacher's recording list marks the currently open
recording as **Opened**. Comment markers appear beside the affected table,
row, or note in the recording view; selecting a marker jumps to and displays
the comment there. A teacher can edit or delete only their own comments, while
students can read them but cannot change them.

New recordings are owned by the signed-in account. Existing recordings saved
with the old browser key are attached to the account that first opens that
archive while signed in. Their audio remains in the `practice_recordings`
volume. The recording model uses Django's storage API, so a future Azure Blob
implementation can replace local file storage while keeping the API and React
workflow.
