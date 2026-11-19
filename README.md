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
- http://localhost:8001/api/curriculum/ — Django API

The Carnatic page loads its sessions, exercises, and Talams from Django and
PostgreSQL. Manage them from Django Admin:

- Create top-level sessions with no parent.
- Create child sessions by selecting a parent session.
- Create Talams with their beat count.
- Create exercises and link each one to a session and Talam.

The default admin credentials are `admin` / `admin` unless changed in `.env`.

Useful commands:

```powershell
docker compose logs -f backend
docker compose ps
docker compose down
```

The PostgreSQL data is kept in the `postgres_data` Docker volume.
